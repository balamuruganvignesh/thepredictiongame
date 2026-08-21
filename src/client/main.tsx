import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { A11yProvider } from './a11ySettings'
import { AuthProvider } from './auth'
import { DeckStyleProvider } from './deckStyle'
import { ThemeProvider } from './theme'
import { registerServiceWorker } from './pwa'
import './styles/tokens.css'
import './styles/app.css'
import './styles/cards.css'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <A11yProvider>
          <DeckStyleProvider>
            <App />
          </DeckStyleProvider>
        </A11yProvider>
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>,
)
