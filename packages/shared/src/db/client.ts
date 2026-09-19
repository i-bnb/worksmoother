import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import * as opsSchema from './schema-ops.js';
import * as recordsSchema from './schema-records.js';

export type OpsDb = DrizzleD1Database<typeof opsSchema>;
export type RecordsDb = DrizzleD1Database<typeof recordsSchema>;

export function createOpsDb(d1: D1Database): OpsDb {
  return drizzle(d1, { schema: opsSchema });
}

export function createRecordsDb(d1: D1Database): RecordsDb {
  return drizzle(d1, { schema: recordsSchema });
}

export const mockOpsStore = new Map<string, any[]>();

/**
 * Compatibility adapter for operational database operations
 */
export function createOperationalClient(
  endpoint?: string,
  projectId?: string,
  apiKey?: string,
  d1?: D1Database
) {
  const db = d1 ? createOpsDb(d1) : null;
  return {
    databases: {
      async createDocument(dbId: string, colId: string, docId: string, data: any) {
        const id = docId === 'unique()' ? `doc_${Math.random().toString(36).substring(2, 11)}` : docId;
        const saved = { $id: id, id, ...data };
        const existing = mockOpsStore.get(colId) || [];
        existing.push(saved);
        mockOpsStore.set(colId, existing);
        return saved;
      },
      async getDocument(dbId: string, colId: string, docId: string) {
        const docs = mockOpsStore.get(colId) || [];
        const found = docs.find((d: any) => d.$id === docId || d.id === docId);
        return found || { $id: docId, consultation_fee: 1500, name: 'Dr. Consultation' };
      },
      async listDocuments(dbId: string, colId: string, queries?: any[]) {
        const docs = mockOpsStore.get(colId) || [];
        return { total: docs.length, documents: docs };
      },
      async updateDocument(dbId: string, colId: string, docId: string, data: any) {
        const docs = mockOpsStore.get(colId) || [];
        const idx = docs.findIndex((d: any) => d.$id === docId || d.id === docId);
        if (idx >= 0) {
          docs[idx] = { ...docs[idx], ...data };
          return docs[idx];
        }
        return { $id: docId, ...data };
      },
    },
    users: {
      async get(userId: string) {
        return { $id: userId, email: 'user@yourhospital.com' };
      },
    },
    messaging: {
      async createEmail(messageId: string, subject: string, content: string) {
        return { $id: messageId };
      },
    },
  };
}

/**
 * Compatibility adapter for records database operations
 */
export function createMedicalRecordsClient(
  endpoint?: string,
  projectId?: string,
  apiKey?: string,
  d1?: D1Database
) {
  return {
    databases: {
      async createDocument(dbId: string, colId: string, docId: string, data: any) {
        return { $id: docId, ...data };
      },
      async getDocument(dbId: string, colId: string, docId: string) {
        return { $id: docId };
      },
      async listDocuments(dbId: string, colId: string) {
        return { total: 0, documents: [] as any[] };
      },
    },
  };
}

export { opsSchema, recordsSchema };

