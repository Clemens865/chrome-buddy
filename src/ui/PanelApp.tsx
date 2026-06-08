// PanelApp — the shared panel shell (theme + view routing + BuddyPanel),
// reused by both the side panel and the in-page content-script overlay.
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { THEMES, applyTheme, type ThemeName } from './theme';
import { BuddyPanel, type View } from '../panel/BuddyPanel';
import { ChatView } from '../views/ChatView';
import { AppsView, type AppId } from '../views/AppsView';
// Heavy apps are code-split — each one ships in its own Vite chunk and is
// only fetched when the user opens it. Drops first-paint bundle weight for
// the dominant case (user opens the side panel to chat, not to inspect).
const ConsoleApp = lazy(() =>
  import('../views/apps/ConsoleApp').then((m) => ({ default: m.ConsoleApp })),
);
const ImageApp = lazy(() =>
  import('../views/apps/ImageApp').then((m) => ({ default: m.ImageApp })),
);
const TranscriberApp = lazy(() =>
  import('../views/apps/TranscriberApp').then((m) => ({ default: m.TranscriberApp })),
);
const LiveTranscriberApp = lazy(() =>
  import('../views/apps/LiveTranscriberApp').then((m) => ({ default: m.LiveTranscriberApp })),
);
const WebhookFlowsApp = lazy(() =>
  import('../views/apps/WebhookFlowsApp').then((m) => ({ default: m.WebhookFlowsApp })),
);
const ScrapeApp = lazy(() =>
  import('../views/apps/ScrapeApp').then((m) => ({ default: m.ScrapeApp })),
);
const VizApp = lazy(() =>
  import('../views/apps/VizApp').then((m) => ({ default: m.VizApp })),
);
const TabManagerApp = lazy(() =>
  import('../views/apps/TabManagerApp').then((m) => ({ default: m.TabManagerApp })),
);
const SandboxAppView = lazy(() =>
  import('../views/apps/SandboxAppView').then((m) => ({ default: m.SandboxAppView })),
);
const AppBuilderView = lazy(() =>
  import('../views/apps/AppBuilderView').then((m) => ({ default: m.AppBuilderView })),
);
import { SVG_GENERATOR_APP } from '../apps/builtins/svgGenerator';
import { TEXT_TO_SPEECH_APP } from '../apps/builtins/textToSpeech';
import { SkillsView, FlowsView, HistoryView } from '../views/StubViews';
import { LibraryView } from '../views/LibraryView';
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
  const [chatListOpen, setChatListOpen] = useState(false);
  const [newChatSignal, setNewChatSignal] = useState(0);

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

  // App cards that are chat-coverable (e.g. Summarizer) seed a chat prompt.
  const runPreset = (preset: { prompt: string; mode: ChatMode }) => {
    setPendingRun({ prompt: preset.prompt, mode: preset.mode });
    setOpenApp(null);
    setView('chat');
  };

  let content;
  if (view === 'apps') {
    if (openApp === 'console') content = lazyApp(<ConsoleApp onBack={() => setOpenApp(null)} onHandoff={runPreset} />);
    else if (openApp === 'image') content = lazyApp(<ImageApp onBack={() => setOpenApp(null)} />);
    else if (openApp === 'transcriber') content = lazyApp(<TranscriberApp onBack={() => setOpenApp(null)} />);
    else if (openApp === 'livescribe') content = lazyApp(<LiveTranscriberApp onBack={() => setOpenApp(null)} />);
    else if (openApp === 'webhooks') content = lazyApp(<WebhookFlowsApp onBack={() => setOpenApp(null)} />);
    else if (openApp === 'scrape') content = lazyApp(<ScrapeApp onBack={() => setOpenApp(null)} />);
    else if (openApp === 'viz') content = lazyApp(<VizApp onBack={() => setOpenApp(null)} />);
    else if (openApp === 'tabs') content = lazyApp(<TabManagerApp onBack={() => setOpenApp(null)} />);
    else if (openApp === 'svggen') content = lazyApp(<SandboxAppView app={SVG_GENERATOR_APP} onBack={() => setOpenApp(null)} />);
    else if (openApp === 'tts') content = lazyApp(<SandboxAppView app={TEXT_TO_SPEECH_APP} onBack={() => setOpenApp(null)} />);
    else if (openApp === 'builder') content = lazyApp(<AppBuilderView onBack={() => setOpenApp(null)} onSaved={() => setOpenApp(null)} />);
    else content = <AppsView onOpenApp={setOpenApp} onPreset={runPreset} />;
  } else if (view === 'skills') content = <SkillsView onRunSkill={runSkill} />;
  else if (view === 'flows') content = <FlowsView onRunWorkflow={runWorkflow} />;
  else if (view === 'history') content = <HistoryView />;
  else if (view === 'library') content = <LibraryView />;
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
        newChatSignal={newChatSignal}
        chatListOpen={chatListOpen}
        onCloseChatList={() => setChatListOpen(false)}
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
        onNewChat={() => setNewChatSignal((s) => s + 1)}
        onOpenChatList={() => setChatListOpen(true)}
      >
        {content}
      </BuddyPanel>
    </div>
  );
}

/** Wrap a lazy-loaded App in a Suspense boundary with a minimal loader. The
 * lazy chunk arrives quickly on the local extension; this fallback only
 * flashes on first open of each app per session. */
function lazyApp(node: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <div className="micro" style={{ padding: 24, color: 'var(--panel-muted)', fontSize: 13 }}>
          Loading…
        </div>
      }
    >
      {node}
    </Suspense>
  );
}
