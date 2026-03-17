import Anthropic from '@anthropic-ai/sdk'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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

  const prompt = `Busca eventos en ${destination} en los próximos ${dias || 60} días desde hoy.
  
Responde SOLO con este JSON exacto, sin texto adicional:
{
  "destination": "${destination}",
  "events": [
    {
      "name": "nombre del evento",
      "day": "DD",
      "month": "MMM",
      "category": "music",
      "venue": "lugar",
      "capacity": "aforo",
      "impact": "impacto para hoteles",
      "importance": "high"
    }
  ],
  "rm_insight": "análisis de ${focoMap[foco] || 'impacto hotelero'} en 3 oraciones"
}

Incluye recitales, festivales, deportes, ferias, congresos, festividades. Responde en ${idioma || 'español'}.`

  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

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