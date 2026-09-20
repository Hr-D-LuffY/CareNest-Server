import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import httpStatus from 'http-status'

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())



export default app
