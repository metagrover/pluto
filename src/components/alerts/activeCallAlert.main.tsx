import ReactDOM from 'react-dom/client';
import { ActiveCallAlertWindow } from './ActiveCallAlertWindow';
import '../../index.css';
import './activeCallAlert.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(<ActiveCallAlertWindow />);
