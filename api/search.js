import Anthropic from '@anthropic-ai/sdk'

const rateLimit = new Map()
const MAX_REQUESTS = 15
const WINDOW_MS =  24 * 60 * 60 * 1000 // 24 horas

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0] ||
             req.headers['x-real-ip'] ||
             req.socket?.remoteAddress || 'unknown'

  if (!checkRateLimit(ip)) {
    const record = rateLimit.get(ip)
    const resetIn = Math.ceil((record.start + WINDOW_MS - Date.now()) / 60000)
    return res.status(429).json({
      error: `Límite alcanzado. Podés hacer ${MAX_REQUESTS} búsquedas por hora. Intentá en ${resetIn} minutos.`
    })
  }

  const { destination, dias, foco, idioma } = req.body

  if (!destination) {
    return res.status(400).json({ error: 'Missing destination' })
  }

  const focoMap = {
    general: 'impacto general en demanda hotelera',
    leisure: 'segmento leisure y turismo vacacional',
    mice: 'segmento corporativo, congresos y ferias MICE',
    grupos: 'grupos, agencias y turismo emisivo'
  }

  const hoy = new Date().toISOString().split('T')[0]

  const prompt = `Hoy es ${hoy}. Busca eventos en ${destination} para el período ${dias}.

REGLAS:
- NO incluyas eventos con fecha anterior a ${hoy}
- Ordena cronológicamente de más próximo a más lejano
- Incluye: recitales, festivales, deportes, ferias, congresos, festividades Y feriados nacionales/locales
- Los feriados usan category "festivo"

Responde SOLO con este JSON, sin texto adicional, sin markdown:
{
  "destination": "${destination}",
  "events": [
    {
      "name": "nombre del evento",
      "day": "DD",
      "month": "abreviatura 3 letras mayúsculas en ${idioma || 'español'}",
      "year": "YYYY",
      "category": "music|sport|cultural|mice|gastro|festivo|other",
      "venue": "lugar",
      "capacity": "aforo estimado o vacío",
      "impact": "impacto para revenue management hotelero en 1 línea",
      "importance": "high|medium"
    }
  ],
  "rm_insight": "análisis de ${focoMap[foco] || 'impacto hotelero'} en 3-4 oraciones. Mencioná feriados que generen fines de semana largos."
}

Respondé en ${idioma || 'español'}. Ordenar por fecha ascendente.`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })

    const textBlock = response.content.find(b => b.type === 'text')
    const text = textBlock ? textBlock.text : ''

    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      return res.status(200).json({
        destination,
        events: [],
        rm_insight: text || 'No se encontraron eventos.'
      })
    }

    const data = JSON.parse(match[0])
    return res.status(200).json(data)

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
}