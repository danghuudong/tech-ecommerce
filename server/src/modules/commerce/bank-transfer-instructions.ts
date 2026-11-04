import { receivingBanks } from '../../db/schema.js'
import type { Transaction } from './commerce.persistence.js'
import type { BankInstructions } from './commerce.types.js'

function bankIdentifier(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll('đ', 'd')
    .replace(/[^a-z0-9]/g, '')
}

export async function resolveBankTransferInstructions(
  tx: Transaction,
  instructions: BankInstructions | null,
) {
  if (!instructions) return null
  const identity = bankIdentifier(instructions.bankName)
  if (!identity) return { ...instructions, bankBin: null }
  const banks = await tx.select().from(receivingBanks)
  const matches = banks.filter((bank) =>
    [bank.bin, bank.code, bank.shortName, bank.name].some(
      (name) => bankIdentifier(name) === identity,
    ),
  )
  // Resolve the bank from the order's snapshot. Current checkout settings must
  // never redirect an existing order to a different bank or account.
  return {
    ...instructions,
    bankBin: matches.length === 1 ? (matches[0]?.bin ?? null) : null,
  }
}
