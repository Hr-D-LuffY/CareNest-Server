import app from './app'

const DEFAULT_PORT = 5000

app.listen(DEFAULT_PORT, () => {
  console.log(`CareNest server listening on port ${DEFAULT_PORT}`)
})
