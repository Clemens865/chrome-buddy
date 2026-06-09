// Minimal ambient types for imagetracerjs (the package ships no types). We use
// imageToSVG (URL → SVG string via canvas tracing) in the sandbox bridge.
declare module 'imagetracerjs' {
  type ImageTracerOptions = Record<string, number | boolean | string>;
  const ImageTracer: {
    imageToSVG(url: string, callback: (svg: string) => void, options?: ImageTracerOptions | string): void;
  };
  export default ImageTracer;
}
