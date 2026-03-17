import Anthropic from '@anthropic-ai/sdk'

const rateLimit = new Map()
const MAX_REQUESTS = 30
const WINDOW_MS = 24 * 60 * 60 * 1000

function checkRateLimit(ip) {
  const now = Date.now()
  const record = rateLimit.get(ip)
  if (!record) { rateLimit.set(ip, { count: 1, start: now }); return true }
  if (now - record.start > WINDOW_MS) { rateLimit.set(ip, { count: 1, start: now }); return true }
  if (record.count >= MAX_REQUESTS) return false
  record.count++
  return true
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown'
  if (!checkRateLimit(ip)) {
    const record = rateLimit.get(ip)
    const resetIn = Math.ceil((record.start + WINDOW_MS - Date.now()) / 60000)
    return res.status(429).json({ error: `Límite alcanzado. Intentá en ${resetIn} minutos.` })
  }

  const { destination, dias, foco, idioma } = req.body
  if (!destination) return res.status(400).json({ error: 'Missing destination' })

  const focoMap = {
    general: 'impacto general en demanda hotelera',
    leisure: 'segmento leisure y turismo vacacional',
    mice: 'segmento corporativo, congresos y ferias MICE',
    grupos: 'grupos, agencias y turismo emisivo'
  }

  const hoy = new Date().toISOString().split('T')[0]

  const prompt = `Sos un asistente de revenue management hotelero. Buscá en internet eventos confirmados en ${destination} para el período ${dias}.

Buscá específicamente: conciertos, recitales, festivales de música, partidos de fútbol y otros deportes, maratones, ferias, exposiciones, congresos, feriados nacionales y locales, carnavales, festividades religiosas y culturales.

IMPORTANTE: Devolvé SOLO el siguiente JSON sin ningún texto antes ni después, sin markdown, sin explicaciones:
{"destination":"${destination}","events":[{"name":"nombre exacto del evento","day":"número del día","month":"abreviatura de 3 letras del mes en ${idioma || 'español'} en mayúsculas","year":"año","category":"music|sport|cultural|mice|gastro|festivo|other","venue":"lugar o estadio","capacity":"aforo si lo sabés","impact":"una línea de impacto para hoteles de la zona","importance":"high|medium"}],"rm_insight":"3 oraciones sobre ${focoMap[foco] || 'impacto hotelero'}: pick-up esperado, fechas clave, recomendación de pricing"}

Si no encontrás eventos, igual devolvé el JSON con events vacío. Respondé en ${idioma || 'español'}.`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })

   const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

    // Extraer JSON de forma robusta
    let data
    try {
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('no json')
      data = JSON.parse(match[0])
    } catch(parseErr) {
      // Si el JSON está truncado, intentar recuperar eventos parciales
      try {
        const destMatch = text.match(/"destination"\s*:\s*"([^"]+)"/)
        const eventsMatch = text.match(/"events"\s*:\s*(\[[\s\S]*?)(?:,\s*"rm_insight"|$)/)
        const insightMatch = text.match(/"rm_insight"\s*:\s*"([^"]+)"/)
        
        let events = []
        if (eventsMatch) {
          // Cerrar el array si está truncado
          let evStr = eventsMatch[1]
          if (!evStr.trim().endsWith(']')) {
            // Remover último elemento incompleto y cerrar
            evStr = evStr.replace(/,?\s*\{[^}]*$/, '') + ']'
          }
          events = JSON.parse(evStr)
        }
        
        data = {
          destination: destMatch ? destMatch[1] : destination,
          events,
          rm_insight: insightMatch ? insightMatch[1] : ''
        }
      } catch(e) {
        return res.status(200).json({ destination, events: [], rm_insight: 'Demasiados eventos encontrados. Probá con un período más corto.' })
      }
    }

    return res.status(200).json(data)

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
}