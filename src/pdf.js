/**
 * The quote request as a one-or-more page PDF (US Letter), built with pdf-lib.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE = [612, 792];
const MARGIN = 48;
const BLUE = rgb(11 / 255, 70 / 255, 176 / 255);
const TEXT = rgb(20 / 255, 33 / 255, 61 / 255);
const MUTED = rgb(90 / 255, 98 / 255, 117 / 255);
const LINE = rgb(224 / 255, 228 / 255, 236 / 255);

export function money(value, currency) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(number);
}

export async function quotePdf(quote) {
    const doc = await PDFDocument.create();
    doc.setTitle(`Quote request ${quote.number}`);
    doc.setAuthor('Braintree Scientific');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    // Standard fonts only cover Latin-1 style text; anything else becomes "?".
    const clean = (text, f = font) => Array.from(String(text == null ? '' : text).replace(/\s+/g, ' ').trim())
        .map(ch => { try { f.encodeText(ch); return ch; } catch (e) { return '?'; } })
        .join('');

    const wrap = (text, f, size, width) => {
        const lines = [];
        let line = '';
        // Words wider than the column (long SKUs) are split into pieces that fit.
        const words = clean(text, f).split(' ').flatMap(word => {
            const pieces = [];
            let piece = '';
            for (const ch of word) {
                if (piece && f.widthOfTextAtSize(piece + ch, size) > width) {
                    pieces.push(piece);
                    piece = '';
                }
                piece += ch;
            }
            return [...pieces, piece];
        });
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (f.widthOfTextAtSize(next, size) <= width || !line) {
                line = next;
            } else {
                lines.push(line);
                line = word;
            }
        }
        if (line) lines.push(line);
        return lines.length ? lines : [''];
    };

    let page;
    let y;
    const newPage = () => {
        page = doc.addPage(PAGE);
        y = PAGE[1] - MARGIN;
    };
    const ensure = height => {
        if (y - height < MARGIN) newPage();
    };
    const text = (value, x, size = 10, f = font, color = TEXT) => {
        page.drawText(clean(value, f), { x, y, size, font: f, color });
    };

    newPage();

    // Header
    text('Braintree Scientific', MARGIN, 18, bold, BLUE);
    const right = `Quote request ${quote.number}`;
    page.drawText(right, { x: PAGE[0] - MARGIN - bold.widthOfTextAtSize(right, 12), y: y + 4, size: 12, font: bold, color: TEXT });
    y -= 16;
    text(quote.date, PAGE[0] - MARGIN - font.widthOfTextAtSize(quote.date, 9), 9, font, MUTED);
    text('Request for quotation from the online store', MARGIN, 9, font, MUTED);
    y -= 12;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE[0] - MARGIN, y }, thickness: 1.5, color: BLUE });
    y -= 22;

    // Customer details, two columns
    const columnWidth = (PAGE[0] - MARGIN * 2 - 24) / 2;
    const block = (title, rows) => {
        const lines = [];
        rows.filter(([, value]) => value).forEach(([label, value]) => {
            wrap(`${label}: ${value}`, font, 9.5, columnWidth).forEach(line => lines.push(line));
        });
        return { title, lines: lines.length ? lines : ['-'] };
    };
    const blocks = [
        block('Contact', [['Name', quote.name], ['Email', quote.email], ['Phone', quote.phone]]),
        block('Institution', [['Institution', quote.institution], ['Department', quote.department], ['PI', quote.pi]]),
        block('Ship to', [['Street', quote.street], ['City', quote.city], ['State', quote.state], ['ZIP', quote.zip], ['Country', quote.country]]),
        block('Purchasing', [['PO / funding', quote.po], ['Needed by', quote.neededBy],
            ['Tax exempt', quote.taxExempt === 'yes' ? `Yes${quote.certificateName ? ' (certificate attached to the email)' : ''}` : 'No']]),
    ];
    for (let i = 0; i < blocks.length; i += 2) {
        const pair = blocks.slice(i, i + 2);
        const height = 16 + Math.max(...pair.map(b => b.lines.length)) * 13;
        ensure(height);
        const top = y;
        pair.forEach((b, column) => {
            const x = MARGIN + column * (columnWidth + 24);
            y = top;
            text(b.title.toUpperCase(), x, 8.5, bold, BLUE);
            y -= 14;
            b.lines.forEach(line => { text(line, x, 9.5); y -= 13; });
        });
        y = top - height - 8;
    }

    if (quote.notes) {
        const lines = wrap(quote.notes, font, 9.5, PAGE[0] - MARGIN * 2);
        ensure(18 + lines.length * 13);
        text('NOTES', MARGIN, 8.5, bold, BLUE);
        y -= 14;
        lines.forEach(line => { ensure(13); text(line, MARGIN, 9.5); y -= 13; });
        y -= 10;
    }

    // Items table
    const cols = [
        { label: 'Qty', x: MARGIN, width: 34 },
        { label: 'SKU', x: MARGIN + 38, width: 96 },
        { label: 'Product', x: MARGIN + 138, width: 250 },
        { label: 'Unit price', x: MARGIN + 392, width: 70, right: true },
        { label: 'Line total', x: MARGIN + 446, width: 70, right: true },
    ];
    const tableRight = PAGE[0] - MARGIN;
    const drawRight = (value, rightX, size, f) => {
        const v = clean(value, f);
        page.drawText(v, { x: rightX - f.widthOfTextAtSize(v, size), y, size, font: f, color: TEXT });
    };
    const header = () => {
        page.drawRectangle({ x: MARGIN, y: y - 5, width: tableRight - MARGIN, height: 18, color: rgb(0.95, 0.96, 0.985) });
        cols.forEach((c, i) => {
            if (c.right) drawRight(c.label, i === cols.length - 1 ? tableRight - 4 : c.x + c.width, 8.5, bold);
            else page.drawText(c.label, { x: c.x + 4, y, size: 8.5, font: bold, color: TEXT });
        });
        y -= 20;
    };

    ensure(60);
    text('ITEMS', MARGIN, 8.5, bold, BLUE);
    y -= 16;
    header();

    let total = 0;
    quote.items.forEach(item => {
        const name = wrap(item.name, font, 9, cols[2].width - 8);
        const options = item.options.length ? wrap(item.options.join(' / '), font, 8, cols[2].width - 8) : [];
        const sku = wrap(item.sku || '-', font, 9, cols[1].width - 8);
        const height = Math.max(name.length * 12 + options.length * 11, sku.length * 12) + 6;
        if (y - height < MARGIN) { newPage(); header(); }
        const line = Number(item.unitPrice) * item.quantity;
        if (Number.isFinite(line)) total += line;
        const top = y;
        text(String(item.quantity), cols[0].x + 4, 9);
        sku.forEach((l, i) => { y = top - i * 12; text(l, cols[1].x + 4, 9); });
        y = top;
        drawRight(money(item.unitPrice, quote.currency), cols[3].x + cols[3].width, 9, font);
        drawRight(Number.isFinite(line) ? money(line, quote.currency) : '', tableRight - 4, 9, font);
        name.forEach((l, i) => { y = top - i * 12; text(l, cols[2].x + 4, 9); });
        options.forEach((l, i) => { y = top - name.length * 12 - i * 11; text(l, cols[2].x + 4, 8, font, MUTED); });
        y = top - height + 6;
        page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: tableRight, y: y + 2 }, thickness: 0.5, color: LINE });
        y -= 10;
    });

    ensure(40);
    drawRight(`Cart total: ${money(total, quote.currency)}`, tableRight - 4, 10.5, bold);
    y -= 16;
    text('Prices are the online cart prices when the request was sent; the final quote may differ.', MARGIN, 8, font, MUTED);

    return doc.save();
}
