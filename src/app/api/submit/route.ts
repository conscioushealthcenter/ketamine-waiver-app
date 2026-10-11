import { NextResponse } from 'next/server'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { uploadPdfToDrive } from '@/lib/google-drive'

function methodLabel(method: string, other: string, friend: string) {
  if (method === 'uber_lyft') return 'Uber / Lyft'
  if (method === 'friend_family') return `Friend / Family Member${friend ? ': ' + friend : ''}`
  if (method === 'other') return `Other${other ? ': ' + other : ''}`
  return method
}

async function drawSignatureOnPage(
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  sigDataUrl: string,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number
) {
  try {
    const base64 = sigDataUrl.replace(/^data:image\/png;base64,/, '')
    const sigBytes = Buffer.from(base64, 'base64')
    const sigImage = await pdfDoc.embedPng(sigBytes)
    const dims = sigImage.scaleToFit(maxWidth, maxHeight)
    page.drawImage(sigImage, { x, y: y - dims.height, width: dims.width, height: dims.height })
  } catch {}
}

export async function POST(req: Request) {
  try {
    const data = await req.json()
    const {
      patientName, date,
      arrivalMethod, arrivalOther, arrivalFriend,
      departureMethod, departureOther, departureFriend,
      sig1, sig2, sig3,
    } = data

    if (!patientName || !sig1 || !sig2 || !sig3) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Build PDF
    const pdfDoc = await PDFDocument.create()
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

    const navy = rgb(0.102, 0.153, 0.267)
    const teal = rgb(0.165, 0.486, 0.435)
    const gold = rgb(0.788, 0.659, 0.298)
    const red = rgb(0.753, 0.224, 0.169)
    const gray = rgb(0.36, 0.353, 0.333)
    const lightGray = rgb(0.91, 0.902, 0.878)
    const white = rgb(1, 1, 1)

    const page = pdfDoc.addPage([612, 792])
    const { width, height } = page.getSize()

    // Header
    page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: navy })
    page.drawRectangle({ x: 0, y: height - 83, width, height: 3, color: teal })
    page.drawRectangle({ x: width / 2, y: height - 83, width: width / 2, height: 3, color: gold })

    page.drawText('CONSCIOUS HEALTH', {
      x: 40, y: height - 30,
      font: helveticaBold, size: 7, color: gold,
      
    })
    page.drawText('KETAMINE TREATMENT COMPLIANCE AGREEMENTS', {
      x: 40, y: height - 52,
      font: helveticaBold, size: 13, color: white,
    })
    page.drawText(`Patient: ${patientName}   |   Date: ${date}`, {
      x: 40, y: height - 70,
      font: helvetica, size: 8, color: rgb(0.8, 0.8, 0.8),
    })

    let y = height - 105

    // ─── Agreement 1 ───────────────────────────────
    // Section header
    page.drawRectangle({ x: 30, y: y - 22, width: width - 60, height: 22, color: navy })
    page.drawCircle({ x: 50, y: y - 11, size: 8, color: gold })
    page.drawText('1', { x: 47.5, y: y - 14.5, font: helveticaBold, size: 8, color: navy })
    page.drawText('TRANSPORTATION AGREEMENT', { x: 65, y: y - 15, font: helveticaBold, size: 9, color: white })
    y -= 35

    const bodyText1a = `I, ${patientName}, agree I am not driving myself home after my service and I have a`
    const bodyText1b = `responsible adult driving me or accompanying me home after my service. I understand I should`
    const bodyText1c = `not drive or operate dangerous machinery for the remainder of the day on which I receive my service.`
    ;[bodyText1a, bodyText1b, bodyText1c].forEach(line => {
      page.drawText(line, { x: 40, y, font: helvetica, size: 8.5, color: gray })
      y -= 13
    })
    y -= 4

    // Transport fields
    page.drawText('Method of Arrival:', { x: 40, y, font: helveticaBold, size: 8, color: navy })
    page.drawText(methodLabel(arrivalMethod, arrivalOther, arrivalFriend), { x: 145, y, font: helvetica, size: 8, color: gray })
    page.drawText('Method of Departure:', { x: 310, y, font: helveticaBold, size: 8, color: navy })
    page.drawText(methodLabel(departureMethod, departureOther, departureFriend), { x: 425, y, font: helvetica, size: 8, color: gray })
    y -= 20

    // Sig line 1
    page.drawLine({ start: { x: 40, y }, end: { x: 280, y }, thickness: 0.5, color: lightGray })
    page.drawLine({ start: { x: 370, y }, end: { x: 572, y }, thickness: 0.5, color: lightGray })
    page.drawText('Signature', { x: 40, y: y + 3, font: helvetica, size: 7, color: rgb(0.6, 0.6, 0.6) })
    page.drawText('Date', { x: 370, y: y + 3, font: helvetica, size: 7, color: rgb(0.6, 0.6, 0.6) })
    await drawSignatureOnPage(pdfDoc, page, sig1, 40, y - 2, 220, 45)
    page.drawText(date, { x: 380, y: y - 10, font: helvetica, size: 9, color: gray })
    y -= 18

    // Divider
    page.drawLine({ start: { x: 30, y }, end: { x: width - 30, y }, thickness: 0.5, color: lightGray })
    y -= 18

    // ─── Agreement 2 ───────────────────────────────
    page.drawRectangle({ x: 30, y: y - 22, width: width - 60, height: 22, color: navy })
    page.drawCircle({ x: 50, y: y - 11, size: 8, color: gold })
    page.drawText('2', { x: 47.5, y: y - 14.5, font: helveticaBold, size: 8, color: navy })
    page.drawText('90-MINUTE MONITORING AGREEMENT', { x: 65, y: y - 15, font: helveticaBold, size: 9, color: white })
    y -= 35

    const lines2 = [
      [`I, ${patientName}, understand I am to be monitored on-site, at Conscious Health, for at least`, false],
      [`90 minutes after time of treatment administration (NOT FROM TIME OF ARRIVAL). I agree to not leave`, true],
      [`the premises of this healthcare setting until the conclusion of the monitoring period.`, false],
    ] as [string, boolean][]

    lines2.forEach(([line, bold]) => {
      page.drawText(line, { x: 40, y, font: bold ? helveticaBold : helvetica, size: 8.5, color: bold ? red : gray })
      y -= 13
    })
    y -= 4

    page.drawLine({ start: { x: 40, y }, end: { x: 280, y }, thickness: 0.5, color: lightGray })
    page.drawLine({ start: { x: 370, y }, end: { x: 572, y }, thickness: 0.5, color: lightGray })
    page.drawText('Signature', { x: 40, y: y + 3, font: helvetica, size: 7, color: rgb(0.6, 0.6, 0.6) })
    page.drawText('Date', { x: 370, y: y + 3, font: helvetica, size: 7, color: rgb(0.6, 0.6, 0.6) })
    await drawSignatureOnPage(pdfDoc, page, sig2, 40, y - 2, 220, 45)
    page.drawText(date, { x: 380, y: y - 10, font: helvetica, size: 9, color: gray })
    y -= 18

    page.drawLine({ start: { x: 30, y }, end: { x: width - 30, y }, thickness: 0.5, color: lightGray })
    y -= 18

    // ─── Agreement 3 ───────────────────────────────
    page.drawRectangle({ x: 30, y: y - 22, width: width - 60, height: 22, color: navy })
    page.drawCircle({ x: 50, y: y - 11, size: 8, color: gold })
    page.drawText('3', { x: 47.5, y: y - 14.5, font: helveticaBold, size: 8, color: navy })
    page.drawText('TREATMENT SAFETY / PRECAUTIONS ACKNOWLEDGEMENT', { x: 65, y: y - 15, font: helveticaBold, size: 9, color: white })
    y -= 35

    const lines3: [string, boolean][] = [
      [`I, ${patientName}, acknowledge that prior to treatment, I was informed to not eat anything within`, false],
      [`four hours of the scheduled treatment time and to not drink any liquids within thirty minutes of the`, false],
      [`scheduled treatment time. I was also informed to not use benzodiazepines nor stimulants (including`, false],
      [`caffeine) within six hours of treatment, and to not use benzodiazepines until at least two hours after.`, false],
    ]
    lines3.forEach(([line]) => {
      page.drawText(line, { x: 40, y, font: helvetica, size: 8.5, color: gray })
      y -= 13
    })
    y -= 4

    const redLines = [
      `Additionally, I attest that I have NOT had any adjunctive ketamine treatments, nor have I`,
      `consumed recreational ketamine since I began treatment at Conscious Health.`,
    ]
    redLines.forEach(line => {
      page.drawText(line, { x: 40, y, font: helveticaBold, size: 8.5, color: red })
      y -= 13
    })
    y -= 6

    page.drawLine({ start: { x: 40, y }, end: { x: 280, y }, thickness: 0.5, color: lightGray })
    page.drawLine({ start: { x: 370, y }, end: { x: 572, y }, thickness: 0.5, color: lightGray })
    page.drawText('Signature', { x: 40, y: y + 3, font: helvetica, size: 7, color: rgb(0.6, 0.6, 0.6) })
    page.drawText('Date', { x: 370, y: y + 3, font: helvetica, size: 7, color: rgb(0.6, 0.6, 0.6) })
    await drawSignatureOnPage(pdfDoc, page, sig3, 40, y - 2, 220, 45)
    page.drawText(date, { x: 380, y: y - 10, font: helvetica, size: 9, color: gray })

    // Footer
    page.drawRectangle({ x: 0, y: 0, width, height: 28, color: navy })
    page.drawText('Conscious Health  ·  Ketamine Treatment Compliance Agreements  ·  Confidential Medical Record', {
      x: 40, y: 10, font: helvetica, size: 7, color: rgb(0.6, 0.6, 0.6),
    })

    const pdfBytes = await pdfDoc.save()

    // Google Drive is the only store. If the upload fails we return an
    // error (caught below) so the patient and staff know to retry — there is
    // no second copy to fall back on.
    const dateSlug = new Date().toISOString().split('T')[0]
    await uploadPdfToDrive(pdfBytes, `${dateSlug}-${Date.now()}.pdf`, patientName.trim())

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Submit error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
