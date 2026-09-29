import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { RequireAuth } from './components/Auth';
import { CalendarPage } from './pages/CalendarPage';
import { Display } from './pages/Display';
import { Editor } from './pages/Editor';
import { Family } from './pages/Family';
import { Settings } from './pages/Settings';

function App() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/edit':
      return (
        <RequireAuth>
          <Editor />
        </RequireAuth>
      );
    case '/calendar':
      return (
        <RequireAuth>
          <CalendarPage />
        </RequireAuth>
      );
    case '/family':
      return (
        <RequireAuth>
          <Family />
        </RequireAuth>
      );
    case '/settings':
      return (
        <RequireAuth>
          <Settings />
        </RequireAuth>
      );
    default:
      return <Display />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
