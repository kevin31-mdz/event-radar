const cache = new Map()
const CACHE_TTL = 6 * 60 * 60 * 1000
const rateLimit = new Map()
const MAX_REQUESTS = 15
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

function getCacheKey(destination, dias, foco, idioma) {
  return `${destination.toLowerCase().trim()}|${dias}|${foco}|${idioma}`
}

function getFromCache(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) { cache.delete(key); return null }
  return entry.data
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() })
  if (cache.size > 200) {
    const now = Date.now()
    for (const [k, v] of cache.entries()) {
      if (now - v.timestamp > CACHE_TTL) cache.delete(k)
    }
  }
}

function safeParseJSON(text) {
  // Limpiar markdown
  let clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  
  // Intentar parse directo
  try { return JSON.parse(clean) } catch(e) {}
  
  // Buscar el objeto JSON
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  
  clean = clean.substring(start, end + 1)
  try { return JSON.parse(clean) } catch(e) {}
  
  // Intentar extraer solo events y destination
  try {
    const destMatch = clean.match(/"destination"\s*:\s*"([^"]+)"/)
    const insightMatch = clean.match(/"rm_insight"\s*:\s*"((?:[^"\\]|\\.)*)"/s)
    
    // Extraer events array de forma robusta
    const evStart = clean.indexOf('"events"')
    const arrStart = clean.indexOf('[', evStart)
    if (arrStart === -1) return null
    
    // Encontrar eventos completos uno por uno
    const events = []
    let pos = arrStart + 1
    let depth = 0
    let objStart = -1
    
    while (pos < clean.length) {
      const ch = clean[pos]
      if (ch === '{') { depth++; if (depth === 1) objStart = pos }
      else if (ch === '}') {
        depth--
        if (depth === 0 && objStart !== -1) {
          try {
            const ev = JSON.parse(clean.substring(objStart, pos + 1))
            events.push(ev)
          } catch(e) {}
          objStart = -1
        }
      } else if (ch === ']' && depth === 0) break
      pos++
    }
    
    return {
      destination: destMatch ? destMatch[1] : '',
      events,
      rm_insight: insightMatch ? insightMatch[1] : ''
    }
  } catch(e) { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { destination, dias, foco, idioma } = req.body
  if (!destination) return res.status(400).json({ error: 'Missing destination' })

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown'
  if (!checkRateLimit(ip)) {
    const record = rateLimit.get(ip)
    const resetIn = Math.ceil((record.start + WINDOW_MS - Date.now()) / 60000)
    return res.status(429).json({ error: `Límite alcanzado. Intentá en ${resetIn} minutos.` })
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY_RADAR
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Missing Gemini API key' })

  const cacheKey = getCacheKey(destination, dias, foco, idioma)
  const cached = getFromCache(cacheKey)
  if (cached) return res.status(200).json({ ...cached, _cached: true })

  const focoMap = { general: 'impacto general en demanda hotelera', leisure: 'segmento leisure y turismo vacacional', mice: 'segmento corporativo, congresos y ferias MICE', grupos: 'grupos, agencias y turismo emisivo' }
  const hoy = new Date().toISOString().split('T')[0]

  const prompt = `Buscá en internet eventos confirmados en ${destination} para el período ${dias}. Incluí conciertos, festivales, deportes, ferias, congresos, feriados y festividades. Solo eventos con fecha ${hoy} o posterior.

Respondé ÚNICAMENTE con JSON puro sin markdown ni texto extra:
{"destination":"${destination}","events":[{"name":"nombre sin comillas dobles internas","day":"DD","month":"MMM mayúsculas en ${idioma||'español'}","year":"YYYY","category":"music|sport|cultural|mice|gastro|festivo|other","venue":"lugar sin comillas dobles","capacity":"aforo","impact":"impacto hotelero corto","importance":"high|medium"}],"rm_insight":"análisis corto en 2 oraciones sin comillas dobles internas"}

IMPORTANTE: No uses comillas dobles dentro de los valores de texto. Usá comillas simples si necesitás. Respondé en ${idioma||'español'}.`

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
        })
      }
    )

    const geminiData = await geminiRes.json()
    if (geminiData.error) return res.status(500).json({ error: 'Gemini: ' + geminiData.error.message })

    const parts = geminiData.candidates?.[0]?.content?.parts || []
    const text = parts.filter(p => p.text).map(p => p.text).join('')

    const data = safeParseJSON(text)

    if (!data || !data.events) {
      return res.status(200).json({ destination, events: [], rm_insight: 'No se pudieron procesar los eventos encontrados.' })
    }

    if (data.events.length > 0) setCache(cacheKey, data)

    return res.status(200).json(data)

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
