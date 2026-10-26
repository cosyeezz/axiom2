import { createRoot } from 'react-dom/client';
import { Icons } from '../../src/client/components.js';
import DesktopPiRemoval from '../../src/client/pages/DesktopPiRemoval.js';
import '../../src/client/styles/tokens.css';
import '../../src/client/styles/connect.css';
import '../../src/client/styles/theme.css';
createRoot(document.getElementById('root')!).render(<><div className="desktop-icon-definitions"><Icons /></div><main className="connect-page"><div className="startup-panel"><DesktopPiRemoval onRescan={async () => true} /></div></main></>);
