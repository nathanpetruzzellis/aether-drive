import { S3Client, CreateBucketCommand, PutBucketVersioningCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

/**
 * Service Storj pour créer et gérer des buckets Storj automatiquement.
 * 
 * Ce service utilise les credentials Storj master (configurés dans les variables d'environnement)
 * pour créer des buckets dédiés pour chaque utilisateur.
 */
export class StorjService {
  private masterAccessKeyId: string;
  private masterSecretAccessKey: string;
  private endpoint: string;

  constructor() {
    // Credentials Storj master (gérés par Aether Drive)
    this.masterAccessKeyId = process.env.STORJ_MASTER_ACCESS_KEY_ID || '';
    this.masterSecretAccessKey = process.env.STORJ_MASTER_SECRET_ACCESS_KEY || '';
    this.endpoint = process.env.STORJ_ENDPOINT || 'https://gateway.storjshare.io';

    if (!this.masterAccessKeyId || !this.masterSecretAccessKey) {
      console.warn('⚠️ Storj master credentials non configurés. La création automatique de buckets sera désactivée.');
    }
  }

  /**
   * Crée un bucket Storj pour un utilisateur.
   * 
   * @param userId UUID de l'utilisateur
   * @returns Configuration Storj pour l'utilisateur (bucket_name, access_key_id, secret_access_key)
   */
  async createUserBucket(userId: string): Promise<{
    bucket_name: string;
    access_key_id: string;
    secret_access_key: string;
    endpoint: string;
  }> {
    if (!this.masterAccessKeyId || !this.masterSecretAccessKey) {
      throw new Error('Storj master credentials non configurés');
    }

    const bucketName = `aether-user-${userId.replace(/-/g, '')}`;

    // Crée le client S3 avec les credentials master
    const credentials = {
      accessKeyId: this.masterAccessKeyId,
      secretAccessKey: this.masterSecretAccessKey,
    };

    const s3Client = new S3Client({
      credentials,
      endpoint: this.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
    });

    try {
      // Crée le bucket
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: bucketName,
        })
      );

      // Active le versioning (optionnel mais recommandé)
      try {
        await s3Client.send(
          new PutBucketVersioningCommand({
            Bucket: bucketName,
            VersioningConfiguration: {
              Status: 'Enabled',
            },
          })
        );
      } catch (versioningError) {
        // Le versioning peut ne pas être supporté, on continue quand même
        console.warn('Impossible d\'activer le versioning pour le bucket:', versioningError);
      }

      // Pour l'instant, on utilise les mêmes credentials master pour tous les buckets
      // TODO: Implémenter la création de credentials dédiés par bucket via Storj API
      // Pour V1, on utilise les credentials master mais avec un bucket isolé par utilisateur
      return {
        bucket_name: bucketName,
        access_key_id: this.masterAccessKeyId,
        secret_access_key: this.masterSecretAccessKey,
        endpoint: this.endpoint,
      };
    } catch (error) {
      console.error('Erreur lors de la création du bucket Storj:', error);
      throw new Error(`Failed to create Storj bucket: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Vérifie si un bucket existe.
   */
  async bucketExists(bucketName: string): Promise<boolean> {
    if (!this.masterAccessKeyId || !this.masterSecretAccessKey) {
      return false;
    }

    const credentials = {
      accessKeyId: this.masterAccessKeyId,
      secretAccessKey: this.masterSecretAccessKey,
    };

    const s3Client = new S3Client({
      credentials,
      endpoint: this.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
    });

    try {
      await s3Client.send(
        new HeadBucketCommand({
          Bucket: bucketName,
        })
      );
      return true;
    } catch (error: any) {
      // Si le bucket n'existe pas, on reçoit une erreur 404
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}

