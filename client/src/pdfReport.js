import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }
const NA_CELLS = { 45: ['Initial'], 50: ['Initial'] }
const isNA = (temp, tp) => (NA_CELLS[temp] || []).includes(tp)
const fmt = v => (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(2)
const NA_FILL = [220, 220, 220]
const BLUE_FILL = [219, 234, 254]
const AMBER_FILL = [254, 243, 199]
const RED_FILL = [254, 226, 226]
const HEADER_FILL = [30, 64, 175]

export async function generatePDF(sample) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const byTP = Object.fromEntries((sample.results || []).map(r => [r.time_point, r]))

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 12

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFillColor(...HEADER_FILL)
  doc.rect(0, 0, pageW, 18, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Stability Test Result', margin, 12)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, pageW - margin, 12, { align: 'right' })

  // ── Sample Info ───────────────────────────────────────────────────────────
  const infoY = 24
  doc.setTextColor(30, 30, 30)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Sample:', margin, infoY)
  doc.text('Ref No:', margin + 60, infoY)
  doc.text('Date Started:', margin + 110, infoY)
  doc.text('Remarks:', margin + 165, infoY)

  doc.setFont('helvetica', 'normal')
  doc.text(sample.name || '', margin + 17, infoY)
  doc.text(sample.ref_no || '—', margin + 74, infoY)
  doc.text(sample.date_started || '—', margin + 134, infoY)
  doc.text(sample.remarks || '—', margin + 181, infoY)

  // Spec limits line
  const hasSpec = sample.spec_ph_min != null || sample.spec_ph_max != null || sample.spec_visc_min != null || sample.spec_visc_max != null
  if (hasSpec) {
    const specY = infoY + 6
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(80, 80, 80)
    doc.text('Spec:', margin, specY)
    doc.setFont('helvetica', 'normal')
    const phSpec = (sample.spec_ph_min != null || sample.spec_ph_max != null)
      ? `pH ${sample.spec_ph_min ?? '—'} – ${sample.spec_ph_max ?? '—'}` : ''
    const viscSpec = (sample.spec_visc_min != null || sample.spec_visc_max != null)
      ? `Viscosity ${sample.spec_visc_min ?? '—'} – ${sample.spec_visc_max ?? '—'} cP` : ''
    doc.text([phSpec, viscSpec].filter(Boolean).join('   '), margin + 12, specY)
  }

  // Divider
  doc.setDrawColor(200, 200, 200)
  doc.line(margin, infoY + 4, pageW - margin, infoY + 4)

  // ── Results Table ─────────────────────────────────────────────────────────
  const pdfTemps = sample.temps || [
    { value: 25, na_tps: [] },
    { value: 45, na_tps: ['Initial'] },
    { value: 50, na_tps: ['Initial'] },
  ]
  const PDF_SUFFIXES = ['25', '45', '50']
  const TEMP_FILLS = [BLUE_FILL, AMBER_FILL, RED_FILL]
  const TEMP_TEXT = [[30, 80, 180], [146, 64, 14], [185, 28, 28]]

  const row1 = [{ content: 'Duration', rowSpan: 2, styles: { valign: 'middle', fontStyle: 'bold' } }]
  const row2 = []
  pdfTemps.forEach((t, i) => {
    const fill = TEMP_FILLS[i] || BLUE_FILL
    const textColor = TEMP_TEXT[i] || [30, 80, 180]
    row1.push({ content: `${t.value}°C`, colSpan: 4, styles: { halign: 'center', fontStyle: 'bold', fillColor: fill, textColor } })
    row2.push(
      { content: 'pH', styles: { halign: 'center', fillColor: fill } },
      { content: 'Viscosity (cP)', styles: { halign: 'center', fillColor: fill } },
      { content: 'Spindle #', styles: { halign: 'center', fillColor: fill } },
      { content: 'RPM', styles: { halign: 'center', fillColor: fill } },
    )
  })
  row1.push({ content: 'Notes', rowSpan: 2, styles: { valign: 'middle', fontStyle: 'bold' } })
  const tableHead = [row1, row2]

  const naCell = { content: '—', styles: { fillColor: NA_FILL, textColor: [160, 160, 160], halign: 'center' } }
  const numCell = val => ({ content: fmt(val) || '', styles: { halign: 'center' } })
  const txtCell = val => ({ content: val || '', styles: { halign: 'center', fontSize: 7 } })

  const tableBody = TIME_POINTS.map(tp => {
    const r = byTP[tp]
    const row = [{ content: TIME_LABELS[tp], styles: { fontStyle: 'bold' } }]
    pdfTemps.forEach((t, i) => {
      const suf = PDF_SUFFIXES[i]
      const isNAtp = (t.na_tps || []).includes(tp)
      if (isNAtp) {
        row.push(naCell, naCell, naCell, naCell)
      } else {
        row.push(
          numCell(r?.[`ph_${suf}`]),
          numCell(r?.[`viscosity_${suf}`]),
          txtCell(r?.[`spindle_${suf}`]),
          txtCell(r?.[`rpm_${suf}`] != null && r?.[`rpm_${suf}`] !== '' ? String(Math.round(Number(r[`rpm_${suf}`]))) : ''),
        )
      }
    })
    row.push({ content: r?.notes || '', styles: { fontSize: 7 } })
    return row
  })

  const colStyles = { 0: { cellWidth: 20 } }
  pdfTemps.forEach((_, i) => {
    const base = 1 + i * 4
    colStyles[base] = { cellWidth: 16, halign: 'center' }
    colStyles[base + 1] = { cellWidth: 20, halign: 'center' }
    colStyles[base + 2] = { cellWidth: 15, halign: 'center' }
    colStyles[base + 3] = { cellWidth: 12, halign: 'center' }
  })

  autoTable(doc, {
    startY: hasSpec ? infoY + 14 : infoY + 8,
    head: tableHead,
    body: tableBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, lineColor: [200, 200, 200], lineWidth: 0.2 },
    headStyles: { fillColor: [248, 250, 252], textColor: [30, 30, 30], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: colStyles,
    margin: { left: margin, right: margin },
  })

  // ── Organoleptic Table ────────────────────────────────────────────────────
  const hasOrgano = (sample.results || []).some(r => r.appearance || r.color_obs || r.odor || r.phase_sep)
  if (hasOrgano) {
    const orgY = doc.lastAutoTable.finalY + 6
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(80, 50, 140)
    doc.text('Organoleptic Observations', margin, orgY)

    const orgHead = [['Duration', 'Appearance', 'Color', 'Odor', 'Phase Separation']]
    const orgBody = TIME_POINTS.map(tp => {
      const r = byTP[tp]
      return [TIME_LABELS[tp], r?.appearance || '', r?.color_obs || '', r?.odor || '', r?.phase_sep || '']
    })
    autoTable(doc, {
      startY: orgY + 3,
      head: orgHead,
      body: orgBody,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, lineColor: [200, 200, 200], lineWidth: 0.2 },
      headStyles: { fillColor: [109, 40, 217], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: [250, 245, 255] },
      columnStyles: { 0: { cellWidth: 20, fontStyle: 'bold' } },
      margin: { left: margin, right: margin },
    })
  }

  // ── Images ────────────────────────────────────────────────────────────────
  const imageFiles = (sample.images || []).filter(img => img.url && /\.(jpe?g|png|gif|webp)$/i.test(img.original_name || img.filename || ''))

  if (imageFiles.length > 0) {
    const tableBottom = doc.lastAutoTable.finalY + 8
    let imgY = tableBottom

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 30, 30)
    doc.text('Attached Images', margin, imgY)
    imgY += 5

    const imgW = 45
    const imgH = 35
    const imgGap = 4
    let imgX = margin
    let rowMaxH = 0

    for (const img of imageFiles) {
      try {
        const imgData = await loadImageAsBase64(img.url)
        const name = img.original_name || img.filename || ''
        const ext = name.split('.').pop().toUpperCase().replace('JPG', 'JPEG')

        if (imgX + imgW > pageW - margin) {
          imgX = margin
          imgY += rowMaxH + imgGap + 10
          rowMaxH = 0
          if (imgY + imgH > pageH - 15) { doc.addPage(); imgY = 15 }
        }

        doc.addImage(imgData, ext === 'JPG' ? 'JPEG' : ext, imgX, imgY, imgW, imgH, '', 'MEDIUM')
        doc.setDrawColor(200, 200, 200)
        doc.rect(imgX, imgY, imgW, imgH)

        if (img.caption) {
          doc.setFontSize(6)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(100, 100, 100)
          doc.text(img.caption.substring(0, 25), imgX + imgW / 2, imgY + imgH + 3, { align: 'center' })
        }

        imgX += imgW + imgGap
        rowMaxH = Math.max(rowMaxH, imgH)
      } catch {
        // skip images that can't be loaded
      }
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 160)
    doc.setFont('helvetica', 'normal')
    doc.text(`FormuLab Hub · ${sample.name}`, margin, pageH - 6)
    doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 6, { align: 'right' })
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const safeName = (sample.name || 'sample').replace(/[^a-zA-Z0-9_-]/g, '_')
  const dateStr = new Date().toISOString().split('T')[0]
  doc.save(`stability_${safeName}_${dateStr}.pdf`)
}

// ── Formulation Sheet PDF ─────────────────────────────────────────────────────

export async function generateFormulationPDF(f) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14

  // ── Letterhead ──────────────────────────────────────────────────────────────
  let y = margin

  // Company name
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
  doc.text(f.company_name || 'TECHNECTURE SDN BHD', margin, y)
  y += 5

  // Address + contacts
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60)
  const addrLines = (f.company_address || '').split('\n')
  addrLines.forEach(line => { doc.text(line, margin, y); y += 4 })
  doc.text(`Tel: ${f.company_tel || ''}    Fax: ${f.company_fax || ''}`, margin, y); y += 3

  // Logo (top right)
  if (f.logo_url) {
    try {
      const logoB64 = await loadImageAsBase64(f.logo_url)
      doc.addImage(logoB64, 'JPEG', pageW - margin - 38, margin - 2, 38, 18, '', 'MEDIUM')
    } catch {}
  }

  // Divider
  doc.setDrawColor(180, 180, 180); doc.line(margin, y + 1, pageW - margin, y + 1); y += 6

  // Product name + ref
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
  doc.text(f.product_name || '', margin, y)
  if (f.ref_no) {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(f.ref_no, pageW - margin, y, { align: 'right' })
  }
  y += 5

  // Description
  if (f.description) {
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80)
    const lines = doc.splitTextToSize(f.description, pageW - margin * 2)
    doc.text(lines, margin, y); y += lines.length * 4 + 2
  }

  // ── Ingredients Table ────────────────────────────────────────────────────────
  const bulkSize = parseFloat(f.bulk_size) || 0
  const calcBulk = pct => {
    const n = parseFloat(pct); if (isNaN(n) || bulkSize <= 0) return ''
    return (n / 100 * bulkSize).toFixed(2)
  }

  const ingHead = [['No', 'Trade Name', 'INCI Name', 'CAS No.', '%', bulkSize > 0 ? `Bulk (${bulkSize}g)` : 'Bulk', 'Principal', 'Function', 'Compliance']]
  const ingBody = (f.ingredients || []).map((r, i) => [
    `${r.part ? `[${r.part}] ` : ''}${i + 1}`,
    r.trade_name || '', r.inci_name || '', r.cas_no || '',
    r.percent || '', calcBulk(r.percent),
    r.supplier || '', r.function || '', r.compliance || '',
  ])
  const total = (f.ingredients || []).reduce((s, r) => s + (parseFloat(r.percent) || 0), 0)
  ingBody.push([{ content: 'Total', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
    { content: `${total.toFixed(2)}%`, styles: { halign: 'right', fontStyle: 'bold' } },
    { content: bulkSize > 0 ? `${(total / 100 * bulkSize).toFixed(2)}g` : '', styles: { fontStyle: 'bold' } },
    '', '', ''])

  autoTable(doc, {
    startY: y, head: ingHead, body: ingBody, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: 0.2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 12 }, 3: { cellWidth: 18 }, 4: { cellWidth: 10, halign: 'right' }, 5: { cellWidth: 16, halign: 'right' } },
    margin: { left: margin, right: margin },
  })
  y = doc.lastAutoTable.finalY + 7

  // ── Procedure ────────────────────────────────────────────────────────────────
  if ((f.procedure || []).some(s => s.text)) {
    if (y > pageH - 60) { doc.addPage(); y = margin }
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
    doc.text('Procedure:', margin, y); y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50, 50, 50)
    f.procedure.forEach((s, i) => {
      if (!s.text) return
      const lines = doc.splitTextToSize(`${i + 1}  ${s.text}`, pageW - margin * 2 - 4)
      if (y + lines.length * 4 > pageH - 20) { doc.addPage(); y = margin }
      doc.text(lines, margin + 2, y); y += lines.length * 4 + 1
    })
    y += 4
  }

  // ── Specs + Ref Image (side by side) ─────────────────────────────────────────
  const hasSpecs = (f.specifications || []).some(s => s.property)
  const hasRefImg = !!f.ref_image_url

  if (hasSpecs || hasRefImg) {
    if (y > pageH - 60) { doc.addPage(); y = margin }
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
    doc.text(`Product Properties @ ${(f.specifications || []).some(s => s.property?.includes('°')) ? '' : '25°C'}:`, margin, y)
    y += 5

    const specsBody = (f.specifications || []).filter(s => s.property).map(s => [s.property, s.value || ''])
    if (f.remarks) specsBody.push(['Remarks', f.remarks])

    const specsW = hasRefImg ? (pageW - margin * 2) * 0.62 : pageW - margin * 2
    autoTable(doc, {
      startY: y, body: specsBody, theme: 'plain',
      styles: { fontSize: 8, cellPadding: 1.5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 }, 1: {} },
      tableWidth: specsW, margin: { left: margin, right: margin },
    })

    if (hasRefImg) {
      try {
        const imgB64 = await loadImageAsBase64(f.ref_image_url)
        const imgX = margin + specsW + 4
        const imgW = pageW - margin - imgX
        doc.addImage(imgB64, 'JPEG', imgX, y - 2, imgW, 42, '', 'MEDIUM')
        doc.setDrawColor(200, 200, 200); doc.rect(imgX, y - 2, imgW, 42)
      } catch {}
    }
    y = doc.lastAutoTable.finalY + 6
  }

  // ── Disclaimer ───────────────────────────────────────────────────────────────
  if (f.disclaimer) {
    const disclaimerLines = doc.splitTextToSize(f.disclaimer, pageW - margin * 2)
    const disclaimerH = disclaimerLines.length * 3.2 + 6
    const totalPg = doc.internal.getNumberOfPages()
    doc.setPage(totalPg)
    const dY = pageH - disclaimerH - 6
    doc.setDrawColor(200, 200, 200); doc.line(margin, dY - 2, pageW - margin, dY - 2)
    doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.setTextColor(130, 130, 130)
    doc.text(disclaimerLines, margin, dY + 2)
  }

  // ── Page numbers ─────────────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(7); doc.setTextColor(180, 180, 180)
    doc.text(`${f.product_name || 'Formulation'} · ${f.ref_no || ''}`, margin, pageH - 4)
    doc.text(`Page ${i} / ${totalPages}`, pageW - margin, pageH - 4, { align: 'right' })
  }

  const safeName = (f.product_name || 'formulation').replace(/[^a-zA-Z0-9_-]/g, '_')
  doc.save(`formulation_${safeName}_${new Date().toISOString().split('T')[0]}.pdf`)
}

// ── Analysis Report PDF ───────────────────────────────────────────────────────

const ANALYSIS_TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const ANALYSIS_TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }

export async function generateAnalysisPDF(sample, analysisData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14

  // Pre-load microscope images
  const imgData = {}
  for (const tp of ANALYSIS_TIME_POINTS) {
    const img = (sample.images || []).find(i =>
      i.category === 'microscope' && i.time_point === tp &&
      /\.(jpe?g|png|gif|webp)$/i.test(i.original_name || i.filename || ''))
    if (img) {
      try { imgData[tp] = await loadImageAsBase64(img.url) } catch {}
    }
  }

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFillColor(...HEADER_FILL)
  doc.rect(0, 0, pageW, 18, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text('Stability Analysis Report', margin, 12)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, pageW - margin, 12, { align: 'right' })

  // ── Sample info ───────────────────────────────────────────────────────────
  let y = 24
  doc.setTextColor(30, 30, 30); doc.setFontSize(9)
  doc.setFont('helvetica', 'bold'); doc.text('Sample:', margin, y)
  doc.setFont('helvetica', 'normal'); doc.text(sample.name || '', margin + 18, y)
  if (sample.ref_no) {
    doc.setFont('helvetica', 'bold'); doc.text('Ref:', margin + 90, y)
    doc.setFont('helvetica', 'normal'); doc.text(sample.ref_no, margin + 100, y)
  }
  doc.setFont('helvetica', 'bold'); doc.text('Started:', pageW - margin - 42, y)
  doc.setFont('helvetica', 'normal'); doc.text(sample.date_started || '—', pageW - margin - 23, y)
  y += 5
  doc.setDrawColor(200, 200, 200); doc.line(margin, y, pageW - margin, y)
  y += 8

  // ── Per time point sections ───────────────────────────────────────────────
  for (const tp of ANALYSIS_TIME_POINTS) {
    const comment = (analysisData.comments || {})[tp] || ''
    const img = imgData[tp]
    const imgW = 62; const imgH = 52
    const neededH = img ? imgH + 14 : (comment ? 28 : 18)
    if (y + neededH > pageH - 40) { doc.addPage(); y = margin }

    // Time point header bar
    doc.setFillColor(241, 245, 249)
    doc.rect(margin, y, pageW - margin * 2, 8, 'F')
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 64, 175)
    doc.text(ANALYSIS_TIME_LABELS[tp], margin + 3, y + 5.5)
    y += 11

    if (img) {
      try {
        doc.addImage(img, 'JPEG', margin, y, imgW, imgH)
        doc.setDrawColor(200, 200, 200); doc.rect(margin, y, imgW, imgH)
      } catch {}
      if (comment) {
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
        const textX = margin + imgW + 5
        const textW = pageW - margin - textX
        const lines = doc.splitTextToSize(comment, textW)
        doc.text(lines, textX, y + 5)
      }
      y += imgH + 5
    } else if (comment) {
      doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
      const lines = doc.splitTextToSize(comment, pageW - margin * 2)
      doc.text(lines, margin, y)
      y += lines.length * 4.5 + 3
    } else {
      doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor(180, 180, 180)
      doc.text('No data recorded for this time point.', margin, y)
      y += 8
    }

    doc.setDrawColor(225, 225, 225); doc.line(margin, y, pageW - margin, y)
    y += 7
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (analysisData.summary) {
    if (y + 25 > pageH - 40) { doc.addPage(); y = margin }
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
    doc.text('Summary', margin, y); y += 6
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
    const sumLines = doc.splitTextToSize(analysisData.summary, pageW - margin * 2)
    if (y + sumLines.length * 4.5 > pageH - 40) { doc.addPage(); y = margin }
    doc.text(sumLines, margin, y)
    y += sumLines.length * 4.5 + 10
  }

  // ── Conclusion ────────────────────────────────────────────────────────────
  if (analysisData.conclusion) {
    if (y + 25 > pageH - 40) { doc.addPage(); y = margin }
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
    doc.text('Conclusion', margin, y); y += 6
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
    const conLines = doc.splitTextToSize(analysisData.conclusion, pageW - margin * 2)
    if (y + conLines.length * 4.5 > pageH - 40) { doc.addPage(); y = margin }
    doc.text(conLines, margin, y)
  }

  // ── Disclaimer footer ─────────────────────────────────────────────────────
  const disclaimer = analysisData.disclaimer || 'This report is for internal research and development purposes only.'
  const dLines = doc.splitTextToSize(disclaimer, pageW - margin * 2)
  const dH = dLines.length * 3.5 + 8
  const totalPg = doc.internal.getNumberOfPages()
  doc.setPage(totalPg)
  const dY = pageH - dH - 4
  doc.setDrawColor(200, 200, 200); doc.line(margin, dY - 2, pageW - margin, dY - 2)
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(130, 130, 130)
  doc.text(dLines, margin, dY + 3)

  // ── Page numbers ──────────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(7); doc.setTextColor(180, 180, 180)
    doc.text(`${sample.name || 'Analysis'} · FormuLab Hub`, margin, pageH - 4)
    doc.text(`Page ${i} / ${totalPages}`, pageW - margin, pageH - 4, { align: 'right' })
  }

  const safeName = (sample.name || 'sample').replace(/[^a-zA-Z0-9_-]/g, '_')
  doc.save(`analysis_${safeName}_${new Date().toISOString().split('T')[0]}.pdf`)
}

function loadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d').drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = reject
    img.src = url
  })
}
