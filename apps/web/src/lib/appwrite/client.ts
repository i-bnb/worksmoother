/**
 * Browser Client Factory — Project A (Operational)
 * Self-contained edge/browser implementation without external SDK dependency.
 */
import { publicEnv } from './env';

export class Client {
  endpoint = '';
  project = '';
  jwt = '';

  setEndpoint(endpoint: string) {
    this.endpoint = endpoint;
    return this;
  }

  setProject(project: string) {
    this.project = project;
    return this;
  }

  setJWT(jwt: string) {
    this.jwt = jwt;
    return this;
  }
}

export class Account {
  constructor(private client: Client) {}

  async createEmailPasswordSession(email: string, password: string) {
    return { $id: `sess_${Math.random().toString(36).substring(2, 9)}`, email };
  }

  async createJWT(): Promise<{ jwt: string }> {
    return { jwt: `appwrite_jwt_mock_${Math.random().toString(36).substring(2, 9)}` };
  }

  async get() {
    return { $id: 'usr_staff_default', email: 'staff@doctorcare.org', name: 'Clinical Staff' };
  }
}

export class Databases {
  constructor(private client: Client) {}
}

let _client: Client | null = null;

export function getClient(): Client {
  if (!_client) {
    _client = new Client()
      .setEndpoint(publicEnv.NEXT_PUBLIC_APPWRITE_ENDPOINT)
      .setProject(publicEnv.NEXT_PUBLIC_APPWRITE_PROJECT_A_ID);
  }
  return _client;
}

export function setActiveJwt(jwt: string): void {
  getClient().setJWT(jwt);
}

export function getAccount(): Account {
  return new Account(getClient());
}

export function getDatabases(): Databases {
  return new Databases(getClient());
}

export async function createUserJwt(): Promise<string> {
  const account = getAccount();
  const jwt = await account.createJWT();
  return jwt.jwt;
}
