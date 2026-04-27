import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }
const NA_CELLS = { 45: ['Initial'], 50: ['Initial', '2_weeks'] }
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

  // Divider
  doc.setDrawColor(200, 200, 200)
  doc.line(margin, infoY + 4, pageW - margin, infoY + 4)

  // ── Results Table ─────────────────────────────────────────────────────────
  const tableHead = [
    [
      { content: 'Duration', rowSpan: 2, styles: { valign: 'middle', fontStyle: 'bold' } },
      { content: '25°C', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold', fillColor: BLUE_FILL, textColor: [30, 80, 180] } },
      { content: '45°C', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold', fillColor: AMBER_FILL, textColor: [146, 64, 14] } },
      { content: '50°C', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold', fillColor: RED_FILL, textColor: [185, 28, 28] } },
      { content: 'Notes', rowSpan: 2, styles: { valign: 'middle', fontStyle: 'bold' } },
    ],
    [
      { content: 'pH', styles: { halign: 'center', fillColor: BLUE_FILL } },
      { content: 'Viscosity (cP)', styles: { halign: 'center', fillColor: BLUE_FILL } },
      { content: 'pH', styles: { halign: 'center', fillColor: AMBER_FILL } },
      { content: 'Viscosity (cP)', styles: { halign: 'center', fillColor: AMBER_FILL } },
      { content: 'pH', styles: { halign: 'center', fillColor: RED_FILL } },
      { content: 'Viscosity (cP)', styles: { halign: 'center', fillColor: RED_FILL } },
    ],
  ]

  const tableBody = TIME_POINTS.map(tp => {
    const r = byTP[tp]
    const na = (temp) => isNA(temp, tp)

    const cell = (val, temp) => na(temp)
      ? { content: '—', styles: { fillColor: NA_FILL, textColor: [160, 160, 160], halign: 'center' } }
      : { content: fmt(val), styles: { halign: 'center' } }

    return [
      { content: TIME_LABELS[tp], styles: { fontStyle: 'bold' } },
      cell(r?.ph_25, 25),
      cell(r?.viscosity_25, 25),
      cell(r?.ph_45, 45),
      cell(r?.viscosity_45, 45),
      cell(r?.ph_50, 50),
      cell(r?.viscosity_50, 50),
      { content: r?.notes || '', styles: { fontSize: 7 } },
    ]
  })

  autoTable(doc, {
    startY: infoY + 8,
    head: tableHead,
    body: tableBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.5, lineColor: [200, 200, 200], lineWidth: 0.2 },
    headStyles: { fillColor: [248, 250, 252], textColor: [30, 30, 30], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 22 },
      2: { cellWidth: 28 },
      3: { cellWidth: 22 },
      4: { cellWidth: 28 },
      5: { cellWidth: 22 },
      6: { cellWidth: 28 },
      7: { cellWidth: 'auto' },
    },
    margin: { left: margin, right: margin },
  })

  // ── Images ────────────────────────────────────────────────────────────────
  const imageFiles = (sample.images || []).filter(img => /\.(jpe?g|png|gif|webp)$/i.test(img.filename))

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
        const imgData = await loadImageAsBase64(`/uploads/${img.filename}`)
        const ext = img.filename.split('.').pop().toUpperCase().replace('JPG', 'JPEG')

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
    doc.text(`Stability Test Manager · ${sample.name}`, margin, pageH - 6)
    doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 6, { align: 'right' })
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const safeName = (sample.name || 'sample').replace(/[^a-zA-Z0-9_-]/g, '_')
  const dateStr = new Date().toISOString().split('T')[0]
  doc.save(`stability_${safeName}_${dateStr}.pdf`)
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
