export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { destination, dias, foco, idioma } = req.body
  if (!destination) return res.status(400).json({ error: 'Missing destination' })
  const GEMINI_KEY = process.env.GEMINI_API_KEY_RADAR
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Missing Gemini API key' })
  const focoMap = { general: 'impacto general en demanda hotelera', leisure: 'segmento leisure y turismo vacacional', mice: 'segmento corporativo, congresos y ferias MICE', grupos: 'grupos, agencias y turismo emisivo' }
  const hoy = new Date().toISOString().split('T')[0]
  const prompt = `Buscá en internet eventos confirmados en ${destination} para el período ${dias}. Incluí conciertos, festivales, deportes, ferias, congresos, feriados y festividades. Solo eventos con fecha ${hoy} o posterior. Respondé ÚNICAMENTE con JSON puro sin markdown, sin bloques de código, sin comillas triples, sin texto antes ni después. Solo el objeto JSON: {"destination":"${destination}","events":[{"name":"nombre","day":"DD","month":"MMM mayúsculas en ${idioma||'español'}","year":"YYYY","category":"music|sport|cultural|mice|gastro|festivo|other","venue":"lugar","capacity":"aforo","impact":"impacto hotelero en 1 línea","importance":"high|medium"}],"rm_insight":"análisis de ${focoMap[foco]||'impacto hotelero'} en 3 oraciones"} Respondé en ${idioma||'español'}.`
  try {
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
      })
    })
    const geminiData = await geminiRes.json()
    if (geminiData.error) return res.status(500).json({ error: 'Gemini: ' + geminiData.error.message })
    // Juntar todos los text parts
    const parts = geminiData.candidates?.[0]?.content?.parts || []
    const text = parts.filter(p => p.text).map(p => p.text).join('')
    // Limpiar markdown
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) return res.status(200).json({ destination, events: [], rm_insight: clean || 'No se encontraron eventos.' })
    return res.status(200).json(JSON.parse(match[0]))
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
