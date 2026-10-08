import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { formatCents, formatDate, formatInvoiceHours } from "@/lib/format";
import type { Invoice, Snapshot } from "@/lib/invoices/types";

// What the client gets: built only from the Sent snapshot, regenerated on every export.
// Canonical terms only — never RPG labels.

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#222" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 32 },
  title: { fontSize: 24, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#666" },
  parties: { flexDirection: "row", marginBottom: 32 },
  party: { flex: 1 },
  label: { color: "#666", marginBottom: 4 },
  row: { flexDirection: "row", paddingVertical: 4, borderBottom: "0.5pt solid #ddd" },
  head: { fontFamily: "Helvetica-Bold", borderBottom: "1pt solid #222" },
  total: { fontFamily: "Helvetica-Bold", borderBottom: "none", borderTop: "1pt solid #222" },
  desc: { flex: 1 },
  date: { width: 90 },
  project: { width: 120 },
  num: { width: 80, textAlign: "right" },
  section: { marginTop: 32 },
});

const TextLines = ({ text }: { text: (string | null)[] }) => (
  <>
    {text.filter(Boolean).map((t, i) => (
      <Text key={i}>{t}</Text>
    ))}
  </>
);

function InvoiceDocument({ snapshot: x, timesheet }: { snapshot: Snapshot; timesheet: boolean }) {
  const { seller, client } = x;
  return (
    <Document title={`Invoice ${x.number}`} author={seller.businessName ?? seller.name}>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Invoice</Text>
            <Text style={s.bold}>{x.number}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text>Issue date: {formatDate(x.issueDate)}</Text>
            <Text>Due date: {formatDate(x.dueDate)}</Text>
          </View>
        </View>
        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.label}>From</Text>
            <Text style={s.bold}>{seller.businessName ?? seller.name}</Text>
            <TextLines text={[seller.businessName && seller.name, seller.address, seller.email, seller.taxId && `Tax ID: ${seller.taxId}`]} />
          </View>
          <View style={s.party}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.bold}>{client.name}</Text>
            <TextLines text={[client.address, client.email]} />
          </View>
        </View>
        <View style={[s.row, s.head]}>
          <Text style={s.desc}>Description</Text>
          <Text style={s.num}>Hours</Text>
          <Text style={s.num}>Rate</Text>
          <Text style={s.num}>Amount</Text>
        </View>
        {x.lines.map((l) => (
          <View key={l.projectId ?? "general"} style={s.row}>
            <Text style={s.desc}>{l.description}</Text>
            <Text style={s.num}>{formatInvoiceHours(l.seconds)}</Text>
            <Text style={s.num}>{formatCents(l.rateCents)}</Text>
            <Text style={s.num}>{formatCents(l.amountCents)}</Text>
          </View>
        ))}
        <View style={[s.row, s.total]}>
          <Text style={s.desc}>Total</Text>
          <Text style={s.num}>{formatInvoiceHours(x.seconds)}</Text>
          <Text style={s.num} />
          <Text style={s.num}>{formatCents(x.totalCents)}</Text>
        </View>
        {seller.paymentInstructions && (
          <View style={s.section}>
            <Text style={s.label}>Payment instructions</Text>
            <Text>{seller.paymentInstructions}</Text>
          </View>
        )}
      </Page>
      {timesheet && (
        <Page size="LETTER" style={s.page}>
          <Text style={s.title}>Timesheet</Text>
          <Text style={[s.muted, { marginBottom: 16 }]}>Invoice {x.number}</Text>
          <View style={[s.row, s.head]} fixed>
            <Text style={s.date}>Date</Text>
            <Text style={s.project}>Project</Text>
            <Text style={s.desc}>Note</Text>
            <Text style={s.num}>Hours</Text>
          </View>
          {x.timesheet.map((e, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={s.date}>{formatDate(e.date)}</Text>
              <Text style={s.project}>{e.description}</Text>
              <Text style={s.desc}>{e.note ?? ""}</Text>
              <Text style={s.num}>{formatInvoiceHours(e.seconds)}</Text>
            </View>
          ))}
        </Page>
      )}
    </Document>
  );
}

/** A Sent or Paid invoice. */
export type SentInvoice = Invoice & { snapshot: Snapshot };

/** Only the snapshot and the timesheet toggle are read, so live rates never leak in. */
export async function invoicePdf({ snapshot, timesheet }: SentInvoice) {
  const blob = await pdf(<InvoiceDocument snapshot={snapshot} timesheet={timesheet} />).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

/** "INV-0001 – Acme – 2026-10.pdf"; characters a path can't hold become "-". */
export const invoicePdfName = (x: Snapshot) => `${x.number} – ${x.client.name} – ${x.issueDate.slice(0, 7)}.pdf`.replace(/[/\\:]/g, "-");

/** Asks where to save; cancelling writes nothing. */
export async function exportInvoicePdf(invoice: SentInvoice) {
  const path = await save({ defaultPath: invoicePdfName(invoice.snapshot), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (path) await writeFile(path, await invoicePdf(invoice));
}
