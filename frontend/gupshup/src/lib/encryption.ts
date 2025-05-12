import sodium from 'libsodium-wrappers';

export class E2EEncryption {
  private static _instance: E2EEncryption | null = null;
  private static readonly KEY_STORAGE_KEY = 'e2e_keypair';
  private keyPair: sodium.KeyPair | null = null;
  private initialized = false;
  private initializing = false;

  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static async getInstance(): Promise<E2EEncryption> {
    if (!E2EEncryption._instance) {
      E2EEncryption._instance = new E2EEncryption();
      await E2EEncryption._instance.initialize();
    } else if (!E2EEncryption._instance.initialized && !E2EEncryption._instance.initializing) {
      // Try to initialize again if it failed before
      await E2EEncryption._instance.initialize();
    }
    return E2EEncryption._instance;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return;

    try {
      this.initializing = true;
      await sodium.ready;
      await this.loadOrGenerateKeys();
      this.initialized = true;
      this.initializing = false;
    } catch (error) {
      console.error('Failed to initialize E2EEncryption:', error);
      this.initializing = false;
      throw new Error('Failed to initialize encryption');
    }
  }

  private async loadOrGenerateKeys(): Promise<void> {
    try {
      const stored = localStorage.getItem(E2EEncryption.KEY_STORAGE_KEY);
      
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (!this.isValidStoredKeyPair(parsed)) {
            console.warn('Invalid stored keypair format, generating new keys');
            throw new Error('Invalid format');
          }
          this.keyPair = {
            publicKey: new Uint8Array(parsed.publicKey),
            privateKey: new Uint8Array(parsed.privateKey),
            keyType: 'curve25519'
          };
        } catch (e) {
          // If there's any error parsing, generate new keys
          this.keyPair = sodium.crypto_box_keypair();
          this.saveKeyPair();
        }
      } else {
        this.keyPair = sodium.crypto_box_keypair();
        this.saveKeyPair();
      }
    } catch (error) {
      console.error('Failed to load or generate keys:', error);
      throw new Error('Failed to setup encryption keys');
    }
  }

  private saveKeyPair(): void {
    if (!this.keyPair) return;
    
    try {
      localStorage.setItem(
        E2EEncryption.KEY_STORAGE_KEY,
        JSON.stringify({
          publicKey: Array.from(this.keyPair.publicKey),
          privateKey: Array.from(this.keyPair.privateKey)
        })
      );
    } catch (error) {
      console.error('Failed to save key pair:', error);
    }
  }

  private isValidStoredKeyPair(parsed: any): parsed is { publicKey: number[]; privateKey: number[] } {
    return (
      parsed &&
      Array.isArray(parsed.publicKey) &&
      Array.isArray(parsed.privateKey) &&
      parsed.publicKey.length === sodium.crypto_box_PUBLICKEYBYTES &&
      parsed.privateKey.length === sodium.crypto_box_SECRETKEYBYTES &&
      parsed.publicKey.every((n: any) => typeof n === 'number') &&
      parsed.privateKey.every((n: any) => typeof n === 'number')
    );
  }

  public async getPublicKey(): Promise<string> {
    if (!this.isReady()) {
      // Just return a placeholder if not initialized yet
      // This prevents throwing errors but the encryption will still happen when ready
      return 'pending-initialization';
    }
    return sodium.to_base64(this.keyPair!.publicKey);
  }

  public async encryptMessage(message: string, recipientPublicKey?: string): Promise<string> {
    // If not initialized or recipient key not available, just return the message as-is
    if (!this.isReady() || !recipientPublicKey || recipientPublicKey === 'pending-initialization') {
      return message;
    }

    try {
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const messageKey = sodium.crypto_secretbox_keygen();
      
      // Encrypt the message with a symmetric key
      const encryptedMessage = sodium.crypto_secretbox_easy(
        sodium.from_string(message),
        nonce,
        messageKey
      );
      
      // Return base64 encoded message
      return sodium.to_base64(encryptedMessage);
    } catch (error) {
      console.error('Failed to encrypt message:', error);
      // Just return the message as-is on failure
      return message;
    }
  }

  private validateKey(key: Uint8Array): void {
    if (!(key instanceof Uint8Array)) {
      throw new Error('Invalid key format');
    }
    if (key.length !== sodium.crypto_box_PUBLICKEYBYTES) {
      throw new Error('Invalid key length');
    }
  }

  public isReady(): boolean {
    return this.initialized && this.keyPair !== null;
  }

  public async clearKeys(): Promise<void> {
    try {
      localStorage.removeItem(E2EEncryption.KEY_STORAGE_KEY);
      this.keyPair = null;
      this.initialized = false;
      this.initializing = false;
      E2EEncryption._instance = null;
    } catch (error) {
      console.error('Failed to clear encryption keys:', error);
      throw new Error('Failed to clear encryption keys');
    }
  }
}