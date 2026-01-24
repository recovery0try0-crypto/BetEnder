import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');

export class StorageService {
  async read(fileName: string): Promise<any> {
    try {
      const filePath = path.join(DATA_DIR, fileName);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return default value for the specific file
        if (fileName.startsWith('pools_')) {
          return {};
        } else if (fileName === 'tokens.json') {
          return [];
        }
      }
      throw error;
    }
  }

  async write(fileName: string, data: any): Promise<void> {
    const filePath = path.join(DATA_DIR, fileName);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
