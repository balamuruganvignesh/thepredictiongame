import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { A11yProvider } from './a11ySettings'
import { DeckStyleProvider } from './deckStyle'
import './styles/tokens.css'
import './styles/app.css'
import './styles/cards.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <A11yProvider>
      <DeckStyleProvider>
        <App />
      </DeckStyleProvider>
    </A11yProvider>
  </StrictMode>,
)
