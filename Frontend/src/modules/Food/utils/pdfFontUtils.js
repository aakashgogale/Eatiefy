import { ROBOTO_REGULAR_BASE64, ROBOTO_BOLD_BASE64 } from './pdfFontsData'

/**
 * Registers Unicode-compatible Roboto fonts (with full support for ₹ / U+20B9 Indian Rupee glyph)
 * into a jsPDF document instance.
 *
 * @param {import('jspdf').jsPDF} doc - The jsPDF instance
 * @returns {import('jspdf').jsPDF} The configured jsPDF instance
 */
export function setupPdfFonts(doc) {
  if (!doc) return doc

  try {
    const fontList = doc.getFontList ? doc.getFontList() : {}
    const hasRoboto = fontList && fontList['Roboto']

    if (!hasRoboto) {
      // Add regular font to virtual file system and register
      if (ROBOTO_REGULAR_BASE64) {
        doc.addFileToVFS('Roboto-Regular.ttf', ROBOTO_REGULAR_BASE64)
        doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal')
      }

      // Add bold font to virtual file system and register
      if (ROBOTO_BOLD_BASE64) {
        doc.addFileToVFS('Roboto-Bold.ttf', ROBOTO_BOLD_BASE64)
        doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold')
      }
    }

    // Set default active font
    doc.setFont('Roboto', 'normal')
  } catch (err) {
    console.error('[pdfFontUtils] Error registering fonts in jsPDF:', err)
  }

  return doc
}

/**
 * True when the Unicode font is actually registered on this document.
 *
 * jsPDF silently falls back to a standard-14 font (WinAnsi) when `addFont`
 * did not take, and WinAnsi has no ₹ (U+20B9) — that is what turns "₹249"
 * into "??249" in a receipt. Callers use this to pick a safe font name.
 */
export function hasUnicodePdfFont(doc) {
  try {
    const fontList = doc?.getFontList ? doc.getFontList() : null
    return Boolean(fontList && fontList['Roboto'])
  } catch {
    return false
  }
}

/**
 * The font family to draw with. Always prefer the registered Unicode font so
 * no section of a document can silently lose the rupee glyph; only fall back
 * to a built-in when registration genuinely failed.
 */
export function pdfFontFamily(doc) {
  return hasUnicodePdfFont(doc) ? 'Roboto' : 'helvetica'
}

/**
 * Returns autoTable font configuration ensuring the Unicode Roboto font is used
 * across head, body, foot, and column styles.
 */
export function getPdfTableStyles() {
  return {
    styles: {
      font: 'Roboto',
      fontStyle: 'normal',
    },
    headStyles: {
      font: 'Roboto',
      fontStyle: 'bold',
    },
    bodyStyles: {
      font: 'Roboto',
      fontStyle: 'normal',
    },
    footStyles: {
      font: 'Roboto',
      fontStyle: 'bold',
    },
  }
}

/**
 * Formats an amount with the ₹ (Rupee) symbol and 2 decimal places.
 * E.g., formatPdfRupee(249) => "₹249.00"
 */
export function formatPdfRupee(amount) {
  const num = Number(amount)
  if (isNaN(num)) return '₹0.00'
  return `₹${num.toFixed(2)}`
}
