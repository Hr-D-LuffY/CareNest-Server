import app from './app'
import { config } from './app/config'

app.listen(config.port, () => {
  console.log(`CareNest server listening on port ${config.port}`)
})
