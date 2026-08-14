import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@shared/theme/theme.css'
import './styles/app.css'
import './styles/charts.css'
import './styles/progression.css'
import './styles/leaderboard.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
