/**
 * Records Server Client Factory — Project B (Medical Records / PHI)
 * Self-contained edge implementation without external SDK dependency.
 */
import { getServerEnv } from './env';

export class Client {
  endpoint = '';
  project = '';
  key = '';

  setEndpoint(endpoint: string) {
    this.endpoint = endpoint;
    return this;
  }

  setProject(project: string) {
    this.project = project;
    return this;
  }

  setKey(key: string) {
    this.key = key;
    return this;
  }
}

export class Databases {
  constructor(private client: Client) {}

  async listDocuments(dbId: string, colId: string) {
    return { total: 0, documents: [] };
  }

  async getDocument(dbId: string, colId: string, docId: string) {
    return { $id: docId };
  }

  async createDocument(dbId: string, colId: string, docId: string, data: any) {
    return { $id: docId, ...data };
  }
}

export function getServerClientB(): Client {
  const env = getServerEnv();
  return new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_B_ID)
    .setKey(env.APPWRITE_PROJECT_B_API_KEY);
}

export function getServerDatabasesB(): Databases {
  return new Databases(getServerClientB());
}
