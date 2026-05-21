// PanelApp — the shared panel shell (theme + view routing + BuddyPanel),
// reused by both the side panel and the in-page content-script overlay.
import { useEffect, useState } from 'react';
import { THEMES, applyTheme, type ThemeName } from './theme';
import { BuddyPanel, type View } from '../panel/BuddyPanel';
import { ChatView } from '../views/ChatView';
import { AppsView, type AppId } from '../views/AppsView';
import { SummarizerApp } from '../views/apps/SummarizerApp';
import { ConsoleApp } from '../views/apps/ConsoleApp';
import { ImageApp } from '../views/apps/ImageApp';
import { SkillsView, FlowsView, HistoryView } from '../views/StubViews';
import { SettingsView } from '../views/SettingsView';
import { Onboarding } from '../views/Onboarding';
import { usePersistedState } from '../sidepanel/usePersistedState';
import type { ChatMode } from '../agent';
import type { Skill } from '../skills/types';
import type { Workflow } from '../workflows/types';

export interface PendingRun {
  prompt: string;
  mode: ChatMode;
}

export type Surface = 'sidepanel' | 'overlay';

export function PanelApp({ surface, onClose }: { surface: Surface; onClose?: () => void }) {
  // Side panel closes itself natively; the overlay is removed by its mounter.
  const closeHandler = onClose ?? (surface === 'sidepanel' ? () => window.close() : undefined);
  const [themeName, setThemeName] = usePersistedState<ThemeName>('theme', 'slate');
  const [accent, setAccent] = usePersistedState<string>('accent', THEMES.slate.accents[0]);
  // Collapse-to-floating-rail only makes sense for the overlay (the page shows
  // through). The side panel is a fixed-width strip, so it always stays full.
  const [overlayCollapsed, setOverlayCollapsed] = usePersistedState<boolean>('overlayCollapsed', true);
  const collapsible = surface === 'overlay';
  const collapsed = collapsible ? overlayCollapsed : false;
  const [view, setView] = useState<View>('chat');
  const [openApp, setOpenApp] = useState<AppId | null>(null);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [pendingWorkflow, setPendingWorkflow] = useState<Workflow | null>(null);
  const [onboardingDone, setOnboardingDone] = usePersistedState<boolean>('onboardingDone', false);

  // Running a skill jumps to Chat and executes its task in the skill's mode.
  const runSkill = (skill: Skill) => {
    setPendingRun({ prompt: skill.prompt, mode: skill.kind === 'agent' ? 'agent' : 'ask' });
    setOpenApp(null);
    setView('chat');
  };

  // Running a workflow jumps to Chat and executes its steps in sequence.
  const runWorkflow = (wf: Workflow) => {
    setPendingWorkflow(wf);
    setOpenApp(null);
    setView('chat');
  };

  const theme = THEMES[themeName] ?? THEMES.slate;

  useEffect(() => {
    if (!theme.accents.includes(accent)) setAccent(theme.accents[0]);
  }, [themeName]); // eslint-disable-line react-hooks/exhaustive-deps

  const themeVars = applyTheme(theme, accent);

  useEffect(() => {
    if (view !== 'apps') setOpenApp(null);
  }, [view]);

  const handleView = (next: View) => {
    setOpenApp(null);
    setView(next);
  };

  let content;
  if (view === 'apps') {
    if (openApp === 'summarizer') content = <SummarizerApp onBack={() => setOpenApp(null)} />;
    else if (openApp === 'console') content = <ConsoleApp onBack={() => setOpenApp(null)} />;
    else if (openApp === 'image') content = <ImageApp onBack={() => setOpenApp(null)} />;
    else content = <AppsView onOpenApp={setOpenApp} />;
  } else if (view === 'skills') content = <SkillsView onRunSkill={runSkill} />;
  else if (view === 'flows') content = <FlowsView onRunWorkflow={runWorkflow} />;
  else if (view === 'history') content = <HistoryView />;
  else if (view === 'settings')
    content = (
      <SettingsView themeName={themeName} accent={accent} onThemeChange={setThemeName} onAccentChange={setAccent} />
    );
  else
    content = (
      <ChatView
        pendingRun={pendingRun}
        onConsumePending={() => setPendingRun(null)}
        pendingWorkflow={pendingWorkflow}
        onConsumeWorkflow={() => setPendingWorkflow(null)}
      />
    );

  const rootClass = 'root theme-' + themeName + (surface === 'overlay' ? ' is-overlay' : '');

  // First-run: take over with the onboarding/key walkthrough until done or skipped.
  if (!onboardingDone) {
    return (
      <div className={rootClass} style={themeVars}>
        <Onboarding onDone={() => setOnboardingDone(true)} />
      </div>
    );
  }

  return (
    <div className={rootClass} style={themeVars}>
      <BuddyPanel
        view={view}
        onView={handleView}
        collapsed={collapsed}
        collapsible={collapsible}
        onToggleCollapsed={() => setOverlayCollapsed(!overlayCollapsed)}
        onClose={closeHandler}
      >
        {content}
      </BuddyPanel>
    </div>
  );
}
