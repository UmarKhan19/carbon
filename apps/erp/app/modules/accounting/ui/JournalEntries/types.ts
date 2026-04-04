export type ClientJournalLine = {
  id: string;
  accountNumber: string;
  description: string;
  debit: number | null;
  credit: number | null;
};
