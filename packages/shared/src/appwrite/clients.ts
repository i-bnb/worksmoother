import { Client, Databases, Users, Storage, Messaging } from 'node-appwrite';

export interface AppwriteOperationalServices {
  client: Client;
  databases: Databases;
  users: Users;
  messaging: Messaging;
}

export interface AppwriteMedicalServices {
  client: Client;
  databases: Databases;
  storage: Storage;
}

/**
 * Creates an Appwrite client strictly scoped to Project A (Operational Data)
 */
export function createOperationalClient(
  endpoint: string,
  projectId: string,
  apiKey: string
): AppwriteOperationalServices {
  if (!projectId || !apiKey) {
    throw new Error('Project A (Operational Data) credentials missing');
  }

  const client = new Client()
    .setEndpoint(endpoint || 'https://cloud.appwrite.io/v1')
    .setProject(projectId)
    .setKey(apiKey);

  return {
    client,
    databases: new Databases(client),
    users: new Users(client),
    messaging: new Messaging(client),
  };
}

/**
 * Creates an Appwrite client strictly scoped to Project B (Medical Records)
 */
export function createMedicalRecordsClient(
  endpoint: string,
  projectId: string,
  apiKey: string
): AppwriteMedicalServices {
  if (!projectId || !apiKey) {
    throw new Error('Project B (Medical Records) credentials missing');
  }

  const client = new Client()
    .setEndpoint(endpoint || 'https://cloud.appwrite.io/v1')
    .setProject(projectId)
    .setKey(apiKey);

  return {
    client,
    databases: new Databases(client),
    storage: new Storage(client),
  };
}
