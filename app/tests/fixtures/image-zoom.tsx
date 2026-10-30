import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ImageFile, type ImageZoomControls, type ImageZoomState } from "../../src/client/chat/ImageFile.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/file-preview.css";

function picture(width: number, height: number) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1600 1000"><defs><pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="#18383e"/><path d="M100 0H0V100" fill="none" stroke="#c5e8dd" stroke-width="2"/></pattern></defs><rect width="1600" height="1000" fill="url(#grid)"/><text x="400" y="450" fill="#c5e8dd" font-size="60">Axiom · pointer zoom</text></svg>`)}`;
}
const pictures = { normal: picture(1600, 1000), small: picture(160, 100), huge: picture(100000, 100000), broken: "data:image/png;base64,YnJva2Vu" };
function Fixture() {
  const controls = useRef<ImageZoomControls>(null);
  const [zoom, setZoom] = useState<ImageZoomState>({ percent: null, atMin: false, atMax: false });
  const [url, setUrl] = useState(pictures.normal), [mounted, setMounted] = useState(true);
  Object.assign(window, { imageFixture: { setPicture: (name: keyof typeof pictures) => setUrl(pictures[name]), setMounted } });
  return <main style={{ margin: 24 }}>
    <div className="file-preview-toolbar"><button onClick={() => controls.current?.step(-1)} disabled={zoom.atMin}>缩小图片</button><span className="file-zoom">{zoom.percent === null ? "适应" : `${Math.round(zoom.percent)}%`}</span><button onClick={() => controls.current?.step(1)} disabled={zoom.atMax}>放大图片</button><button onClick={() => controls.current?.fit()}>图片适应窗口</button></div>
    <div style={{ display: "flex", height: 520, width: "100%", minWidth: 0 }}>{mounted && <ImageFile url={url} name="缩放测试图片" controls={controls} onZoomChange={setZoom} />}</div>
    <p>滚轮以鼠标位置缩放；保留原生滚动条浏览局部。</p><div style={{ height: 1500 }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
