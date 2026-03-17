import Anthropic from '@anthropic-ai/sdk'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { prompt } = req.body

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' })
  }

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
        destination: 'Sin resultados',
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