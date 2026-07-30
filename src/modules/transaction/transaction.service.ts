import { Injectable } from "@nestjs/common";

import {
  bulkDeleteTransactionService,
  bulkTransactionService,
  createTransactionService,
  deleteTransactionService,
  duplicateTransactionService,
  getAllTransactionService,
  getTransactionByIdService,
  scanReceiptService,
  updateTransactionService,
} from "../../services/transaction.service";

/** Injectable seam over the existing `services/transaction.service` functions. */
@Injectable()
export class TransactionService {
  create(
    body: Parameters<typeof createTransactionService>[0],
    userId: Parameters<typeof createTransactionService>[1],
  ) {
    return createTransactionService(body, userId);
  }

  getAll(
    userId: Parameters<typeof getAllTransactionService>[0],
    filters: Parameters<typeof getAllTransactionService>[1],
    pagination: Parameters<typeof getAllTransactionService>[2],
  ) {
    return getAllTransactionService(userId, filters, pagination);
  }

  getById(
    userId: Parameters<typeof getTransactionByIdService>[0],
    transactionId: Parameters<typeof getTransactionByIdService>[1],
  ) {
    return getTransactionByIdService(userId, transactionId);
  }

  duplicate(
    userId: Parameters<typeof duplicateTransactionService>[0],
    transactionId: Parameters<typeof duplicateTransactionService>[1],
  ) {
    return duplicateTransactionService(userId, transactionId);
  }

  update(
    userId: Parameters<typeof updateTransactionService>[0],
    transactionId: Parameters<typeof updateTransactionService>[1],
    body: Parameters<typeof updateTransactionService>[2],
  ) {
    return updateTransactionService(userId, transactionId, body);
  }

  delete(
    userId: Parameters<typeof deleteTransactionService>[0],
    transactionId: Parameters<typeof deleteTransactionService>[1],
  ) {
    return deleteTransactionService(userId, transactionId);
  }

  bulkDelete(
    userId: Parameters<typeof bulkDeleteTransactionService>[0],
    transactionIds: Parameters<typeof bulkDeleteTransactionService>[1],
  ) {
    return bulkDeleteTransactionService(userId, transactionIds);
  }

  bulkCreate(
    userId: Parameters<typeof bulkTransactionService>[0],
    transactions: Parameters<typeof bulkTransactionService>[1],
  ) {
    return bulkTransactionService(userId, transactions);
  }

  scanReceipt(
    file: Parameters<typeof scanReceiptService>[0],
    categories: Parameters<typeof scanReceiptService>[1],
  ) {
    return scanReceiptService(file, categories);
  }
}
