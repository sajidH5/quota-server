/**
 * The quote request as a Word document (.docx), laid out like Braintree's
 * "Preliminary Quote Request" design: US Letter, IBM Plex fonts (embedded, so it looks the same
 * on computers without them), logo, three address blocks, items table (no prices) and next steps.
 * Staff can edit it and send it back to the customer.
 */
import {
    AlignmentType, BorderStyle, Document, Footer, HeightRule, ImageRun, LineRuleType, Packer, PageNumber,
    Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun,
    VerticalAlignTable, WidthType,
} from 'docx';
import { Buffer } from 'node:buffer';
import * as assets from './assets.js';

const SANS = 'IBM Plex Sans';
const BOLD = 'IBM Plex Sans SmBld'; // the SemiBold file's own family name, so Word picks it up
const MONO = 'IBM Plex Mono';
const MONO_MEDIUM = 'IBM Plex Mono Medm';

const COLOR = {
    blue: '004681', ink: '1B1F23', muted: '5C656D', address: '4A5259', body: '3A4148', line: 'D5DADF',
    notice: 'F2F5F8', badge: 'FFF4E5', badgeLine: 'F0C98E', badgeInk: '8A4B00', white: 'FFFFFF',
};
const COMPANY = {
    address: 'P.O. Box 850498, Braintree, MA 02185',
    phone: '781-917-9526',
    email: 'quotesbsci@braintreesci.com',
    web: 'braintreesci.com',
};
const WIDTH = 528; // content width in points (US Letter, 42 pt margins)

const twips = points => Math.round(points * 20);
const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const line = (color, points) => ({ style: BorderStyle.SINGLE, size: Math.round(points * 8), color });

let binaries;
function files() {
    // Decoded once per instance; Buffer because the docx library embeds fonts from Buffers.
    if (!binaries) binaries = Object.fromEntries(Object.entries(assets).map(([name, base64]) => [name, Buffer.from(base64, 'base64')]));
    return binaries;
}

function text(value, { size = 9, color = COLOR.ink, font = SANS, tracking } = {}) {
    return new TextRun({
        text: String(value == null ? '' : value),
        font,
        size: Math.round(size * 2),
        color,
        characterSpacing: tracking ? twips(tracking) : undefined,
    });
}

function para(children, { align, before = 0, after = 0, lineHeight, tabs, border } = {}) {
    return new Paragraph({
        children: [].concat(children),
        alignment: align,
        spacing: { before: twips(before), after: twips(after), ...(lineHeight ? { line: twips(lineHeight), lineRule: LineRuleType.EXACT } : {}) },
        tabStops: tabs,
        border,
    });
}

const label = value => text(value.toUpperCase(), { size: 7.5, color: COLOR.blue, font: BOLD, tracking: 1.2 });
const spacer = points => para([], { lineHeight: points });

function cell(children, { width, margins = {}, borders = NO_BORDERS, shading, verticalAlign, columnSpan } = {}) {
    return new TableCell({
        children: [].concat(children),
        width: width ? { size: twips(width), type: WidthType.DXA } : undefined,
        margins: {
            top: twips(margins.top || 0), bottom: twips(margins.bottom || 0),
            left: twips(margins.left || 0), right: twips(margins.right || 0),
        },
        borders,
        shading: shading ? { type: ShadingType.CLEAR, color: 'auto', fill: shading } : undefined,
        verticalAlign,
        columnSpan,
    });
}

function table(rows, widths, { align, borders = NO_BORDERS } = {}) {
    return new Table({
        rows,
        width: { size: twips(widths.reduce((a, b) => a + b, 0)), type: WidthType.DXA },
        columnWidths: widths.map(twips),
        layout: TableLayoutType.FIXED,
        alignment: align,
        borders,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
}

/** A box around its content (the notice and tax status panels). */
function box(children, { fill, padding }) {
    const border = line(COLOR.line, 0.75);
    return table([new TableRow({
        children: [cell(children, {
            width: WIDTH, shading: fill, margins: padding,
            borders: { top: border, bottom: border, left: border, right: border },
        })],
    })], [WIDTH]);
}

function header(quote) {
    const logo = new ImageRun({
        type: 'png',
        data: files().logo,
        transformation: { width: 214, height: 81 }, // 160.5 x 60.8 pt
        altText: { name: 'Braintree Scientific', description: 'Braintree Scientific, Inc. Lab Research Products', title: 'Braintree Scientific' },
    });
    const address = value => text(value, { color: COLOR.address });
    const left = [
        para(logo),
        para(address(COMPANY.address), { before: 7, lineHeight: 13.5 }),
        para(address(`Phone ${COMPANY.phone} · ${COMPANY.email} · ${COMPANY.web}`), { lineHeight: 13.5 }),
    ];

    const badgeBorder = line(COLOR.badgeLine, 0.75);
    const badge = table([new TableRow({
        children: [cell(para(text('PRELIMINARY · PENDING REVIEW', { size: 8, color: COLOR.badgeInk, font: BOLD, tracking: 1 }), { align: AlignmentType.CENTER }), {
            width: 157.5, shading: COLOR.badge, margins: { top: 3, bottom: 3, left: 6, right: 6 },
            borders: { top: badgeBorder, bottom: badgeBorder, left: badgeBorder, right: badgeBorder },
        })],
    })], [157.5], { align: AlignmentType.RIGHT });

    const meta = (name, value, font) => new TableRow({
        children: [
            cell(para(text(name, { color: COLOR.muted }), { align: AlignmentType.RIGHT, lineHeight: 16 }), { width: 62 }),
            cell(para(text(value, { font }), { align: AlignmentType.RIGHT, lineHeight: 16 }), { width: 96 }),
        ],
    });
    const details = table([meta('Request no.', quote.number, MONO_MEDIUM), meta('Submitted', quote.day, SANS)], [62, 96], { align: AlignmentType.RIGHT });

    const right = [
        para(text('Quote Request', { size: 19.5, color: COLOR.blue, font: BOLD }), { align: AlignmentType.RIGHT, lineHeight: 26 }),
        spacer(4),
        badge,
        spacer(6),
        details,
    ];

    const rule = { ...NO_BORDERS, bottom: line(COLOR.blue, 1.4) };
    return table([new TableRow({
        children: [
            cell(left, { width: 300, borders: rule, margins: { bottom: 14 } }),
            cell(right, { width: WIDTH - 300, borders: rule, margins: { bottom: 14 } }),
        ],
    })], [300, WIDTH - 300]);
}

function notice() {
    return box([
        para(text('This is not your final quote.', { color: COLOR.blue, font: BOLD }), { lineHeight: 15 }),
        para(text('This summary helps us generate your final quote. Our team will review your tax status and add pricing and shipping costs, then send your official quote by email.'), { lineHeight: 13.6 }),
    ], { fill: COLOR.notice, padding: { top: 8, bottom: 8, left: 13, right: 13 } });
}

function addressColumn(title, lines) {
    const shown = lines.filter(Boolean);
    return [
        para(label(title), { lineHeight: 12, after: 5 }),
        ...(shown.length
            ? shown.map((value, i) => para(text(value, { font: i === 0 ? BOLD : SANS }), { lineHeight: 15.7 }))
            : [para(text('Not provided', { color: COLOR.muted }), { lineHeight: 15.7 })]),
    ];
}

function addresses(quote) {
    const cityLine = (city, state, zip) => [[city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(' ');
    const columns = [
        addressColumn('Requested by', [
            quote.name, quote.department, quote.institution, [quote.email, quote.phone].filter(Boolean).join(' · '),
        ]),
        addressColumn('Bill to', [
            quote.billContact, quote.billInstitution, quote.billStreet,
            cityLine(quote.billCity, quote.billState, quote.billZip), quote.billCountry,
        ]),
        addressColumn('Ship to', [
            quote.shipName, quote.shipBuilding, quote.shipStreet,
            cityLine(quote.shipCity, quote.shipState, quote.shipZip), quote.shipCountry,
        ]),
    ];
    return table([new TableRow({
        children: columns.map((children, i) => cell(children, { width: [181, 181, 166][i] })),
    })], [181, 181, 166]);
}

function taxStatus(quote) {
    const exempt = quote.taxExempt === 'yes';
    return box([
        para([
            label('Tax status'),
            new TextRun({ text: '\t' }),
            text('Tax exempt: ', { color: COLOR.muted }), text(`${exempt ? 'Yes' : 'No'} (as entered)`),
            new TextRun({ text: '\t' }),
            text('Certificate: ', { color: COLOR.muted }), text(quote.certificateName ? 'Attached' : 'Not provided'),
        ], {
            lineHeight: 15,
            tabs: [{ type: TabStopType.LEFT, position: twips(67) }, { type: TabStopType.LEFT, position: twips(195) }],
        }),
        para(text('Braintree will confirm tax status before issuing your final quote.', { size: 8.5, color: COLOR.muted }), { lineHeight: 14 }),
    ], { padding: { top: 7, bottom: 7, left: 10, right: 10 } });
}

// No prices: staff add them on the final quote.
const ITEM_WIDTHS = [36, 84, 315, 45, 48];
const ITEM_ALIGN = [AlignmentType.LEFT, AlignmentType.LEFT, AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.LEFT];

function itemsTable(quote) {
    const head = new TableRow({
        tableHeader: true,
        cantSplit: true,
        height: { value: twips(23.3), rule: HeightRule.EXACT },
        children: ['#', 'Catalog no.', 'Description', 'Qty', 'UOM'].map((title, i) => cell(
            para(text(title.toUpperCase(), { size: 8, color: COLOR.white, font: BOLD, tracking: 0.8 }), { align: ITEM_ALIGN[i] }),
            { width: ITEM_WIDTHS[i], shading: COLOR.blue, verticalAlign: VerticalAlignTable.CENTER, margins: { left: 8, right: 8 } },
        )),
    });
    const rule = { ...NO_BORDERS, bottom: line(COLOR.line, 0.75) };
    const rows = quote.items.map((item, index) => {
        const values = [
            [para(text(index + 1), { lineHeight: 13.6 })],
            [para(text(item.sku, { font: MONO }), { lineHeight: 13.6 })],
            [
                para(text(item.name), { lineHeight: 13.6 }),
                ...(item.options.length ? [para(text(item.options.join(' · '), { size: 8.5, color: COLOR.muted }), { lineHeight: 12.5 })] : []),
            ],
            [para(text(item.quantity), { align: AlignmentType.CENTER, lineHeight: 13.6 })],
            [para(text(item.uom || 'EA'), { lineHeight: 13.6 })],
        ];
        return new TableRow({
            cantSplit: true,
            children: values.map((children, i) => cell(children, {
                width: ITEM_WIDTHS[i], borders: rule, margins: { top: 8, bottom: 8, left: 8, right: 8 },
            })),
        });
    });
    return table([head, ...rows], ITEM_WIDTHS);
}

function nextSteps() {
    const steps = [
        ['1. Request received', 'A copy of this request went to you and to our quote team.'],
        ['2. We review it', 'We confirm your tax status and calculate shipping to your address.'],
        ['3. Final quote by email', 'You receive your official quote with ordering instructions.'],
    ];
    const top = { ...NO_BORDERS, top: line(COLOR.line, 1.4) };
    const gap = () => cell(para([]), { width: 12 });
    const step = ([title, body]) => cell([
        para(text(title, { font: BOLD }), { lineHeight: 15 }),
        para(text(body, { color: COLOR.body }), { lineHeight: 13.6 }),
    ], { width: 168, borders: top, margins: { top: 8 } });
    return [
        para(label('What happens next'), { lineHeight: 12, after: 7 }),
        table([new TableRow({ children: [step(steps[0]), gap(), step(steps[1]), gap(), step(steps[2])] })], [168, 12, 168, 12, 168]),
    ];
}

function certificatesAndQuestions(quote) {
    const body = value => text(value, { color: COLOR.body });
    const left = [
        para(text('Tax-exempt certificates', { font: BOLD }), { lineHeight: 15 }),
        para([text('Universities: ', { font: BOLD }), body('We already have your certificate on file, so there is no need to send it again. Thank you!')], { lineHeight: 12.7 }),
        para([
            text('All other entities: ', { font: BOLD }),
            body(`Email your exemption certificate to ${COMPANY.email} and reference request no. ${quote.number.replace(/-/g, '\u2011')} so we can apply it to your final quote.`),
        ], { before: 3, lineHeight: 12.7 }),
    ];
    const right = [
        para(text('Questions about this request', { font: BOLD }), { lineHeight: 15 }),
        para(body(COMPANY.email), { lineHeight: 12.7 }),
        para(body(COMPANY.phone), { lineHeight: 12.7 }),
    ];
    return table([new TableRow({ children: [cell(left, { width: 263, margins: { right: 12 } }), cell(right, { width: WIDTH - 263, margins: { left: 12 } })] })], [263, WIDTH - 263]);
}

function footer() {
    const small = value => text(value, { size: 8.5, color: COLOR.muted });
    return new Footer({
        children: [new Paragraph({
            border: { top: { ...line(COLOR.line, 0.75), space: 8 } },
            tabStops: [{ type: TabStopType.RIGHT, position: twips(WIDTH) }],
            children: [
                small('Preliminary quote request. Not a final quote. Pricing, shipping and tax are confirmed on your official Braintree Scientific quote.'),
                new TextRun({ text: '\t' }),
                new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: SANS, size: 17, color: COLOR.muted }),
            ],
        })],
    });
}

/** The quote as a .docx file, base64 encoded (for the email attachment). */
export function quoteDocx(quote) {
    const { sans, sansSemiBold, mono, monoMedium } = files();
    const doc = new Document({
        creator: 'Braintree Scientific',
        title: `Quote request ${quote.number}`,
        fonts: [
            { name: SANS, data: sans },
            { name: BOLD, data: sansSemiBold },
            { name: MONO, data: mono },
            { name: MONO_MEDIUM, data: monoMedium },
        ],
        styles: {
            default: {
                document: {
                    run: { font: SANS, size: 18, color: COLOR.ink },
                    paragraph: { spacing: { before: 0, after: 0 } },
                },
            },
        },
        sections: [{
            properties: {
                page: {
                    size: { width: twips(612), height: twips(792) },
                    margin: { top: twips(30), bottom: twips(62), left: twips(42), right: twips(42), header: twips(20), footer: twips(24) },
                },
            },
            footers: { default: footer() },
            children: [
                header(quote),
                spacer(12),
                notice(),
                spacer(15),
                addresses(quote),
                spacer(12),
                taxStatus(quote),
                spacer(11.5),
                itemsTable(quote),
                spacer(14),
                ...nextSteps(),
                spacer(14),
                certificatesAndQuestions(quote),
            ],
        }],
    });
    return Packer.toBase64String(doc);
}
