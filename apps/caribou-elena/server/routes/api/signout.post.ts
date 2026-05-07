import { defineEventHandler, setResponseStatus } from 'h3'
import { clearInstance } from '../../lib/instance-cookie.js'

export default defineEventHandler((event) => {
  clearInstance(event)
  setResponseStatus(event, 204)
  return ''
})
