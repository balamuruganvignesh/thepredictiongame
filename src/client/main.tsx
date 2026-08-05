import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DeckStyleProvider } from './deckStyle'
import './styles/tokens.css'
import './styles/app.css'
import './styles/cards.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeckStyleProvider>
      <App />
    </DeckStyleProvider>
  </StrictMode>,
)
