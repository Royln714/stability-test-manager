import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export async function extractPdfRows(file) {
  const pdf = await getDocument({ data: await file.arrayBuffer(), disableWorker: true }).promise
  const rows = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = content.items
      .filter(item => item.str?.trim())
      .map(item => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
      .sort((a, b) => b.y - a.y || a.x - b.x)
    const pageRows = []
    items.forEach(item => {
      const row = pageRows.find(candidate => Math.abs(candidate.y - item.y) < 3)
      if (row) row.items.push(item)
      else pageRows.push({ y: item.y, items: [item] })
    })
    pageRows.forEach(row => rows.push(row.items.sort((a, b) => a.x - b.x).map(item => item.text)))
  }
  return rows
}
