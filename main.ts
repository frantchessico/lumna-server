import express, { Request, Response } from 'express';
import mongoose, { Document, Schema } from 'mongoose';
import { initializeApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import multer, { MulterError } from 'multer'; 
import dotenv from 'dotenv';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import * as swaggerDocument from './swagger.json';

dotenv.config();

interface AuthenticatedRequest extends Request {
  userId?: string; // O 'userId' será opcional
}

// Inicialização do Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
};

const firebaseApp = initializeApp(firebaseConfig);
const storage = getStorage(firebaseApp);

// Inicialização do Express
const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// Middleware para JSON
app.use(express.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Conexão com o MongoDB
mongoose.connect(process.env.MONGO_URI || '', {})
  .then(() => console.log('MongoDB conectado!'))
  .catch((error) => console.error('Erro ao conectar ao MongoDB:', error));

// Criar enum para categorias
enum AudioCategory {
  ROCK = 'Rock',
  POP = 'Pop',
  JAZZ = 'Jazz',
  CLASSICAL = 'Classical',
  HIP_HOP = 'Hip-hop',
  ELECTRONIC = 'Electronic',
  OTHER = 'Other',
}

// Esquema de Mongoose para músicas
interface IAudio extends Document {
  title: string;
  description: string;
  artist: string;
  artistAvatar: string;
  album: string;
  genre: string;
  duration: number;
  releaseDate: Date;
  copyright: string;
  collaborators: { role: string; name: string }[];
  trackNumber: number;
  totalTracks: number;
  url: string;
  cover: string;
  createdAt: Date;
  producer: string;
  composer: string;
  category: AudioCategory;
  playCount: number;
}

const audioSchema = new Schema<IAudio>({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  artist: { type: String, required: true },
  artistAvatar: { type: String, required: true },
  album: { type: String, default: '' },
  genre: { type: String, default: '' },
  duration: { type: Number, required: true },
  releaseDate: { type: Date, default: Date.now },
  copyright: { type: String, default: '' },
  collaborators: [{ role: { type: String }, name: { type: String } }],
  trackNumber: { type: Number, default: 1 },
  totalTracks: { type: Number, default: 1 },
  url: { type: String, required: true },
  cover: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  producer: { type: String, default: '' },
  composer: { type: String, default: '' },
  category: { type: String, enum: Object.values(AudioCategory), default: AudioCategory.OTHER },
  playCount: { type: Number, default: 0 }
});

const Audio = mongoose.model<IAudio>('Audio', audioSchema);

// Configurando o multer para armazenar o arquivo em memória
const storageMulter = multer.memoryStorage();
const upload = multer({ storage: storageMulter });

// Esquema para álbuns
interface IAlbum extends Document {
  title: string;
  artist: string;
  artistAvatar: string;
  genre: string;
  releaseDate: Date;
  cover: string;
  tracks: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const albumSchema = new Schema<IAlbum>({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  artistAvatar: { type: String, required: true },
  genre: { type: String, required: true },
  releaseDate: { type: Date, default: Date.now },
  cover: { type: String, default: '' },
  tracks: [{ type: Schema.Types.ObjectId, ref: 'Audio' }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Album = mongoose.model<IAlbum>('Album', albumSchema);

// Interface para definir os tipos dos dados que esperamos receber no corpo da requisição
interface UploadRequest extends Request {
  body: {
    title: string;
    description?: string;
    artist: string;
    artistAvatar?: string;
    album?: string;
    genre?: string;
    duration: number;
    releaseDate?: string;
    copyright?: string;
    producer?: string;
    composer?: string;
    trackNumber?: number;
    totalTracks?: number;
    cover?: string;
    collaborators?: { role: string; name: string }[];
    category?: AudioCategory;
  };
  file?: Express.Multer.File;
}

// Middleware fictício para autenticação (você pode usar JWT, por exemplo)
const authenticateUser = (req: Request, res: Response, next: Function): void => {
  const userId = req.headers['user-id'] as string;

  if (!userId) {
    res.status(401).json({ message: 'Usuário não autenticado' });
    return;
  }

  req.userId = userId;
  next();
};

// Rota para upload de áudio
app.post('/upload', upload.single('audioFile'), async (req: UploadRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      description,
      artist,
      artistAvatar,
      album,
      genre,
      duration,
      releaseDate,
      copyright,
      producer,
      composer,
      trackNumber,
      totalTracks,
      cover,
      collaborators,
      category = AudioCategory.OTHER,
    } = req.body;

    if (!title || !artist || !duration || !artistAvatar) {
      res.status(400).send('Título, Artista, Avatar e Duração são obrigatórios.');
      return;
    }

    const audioBuffer = req.file?.buffer;

    if (!audioBuffer) {
      res.status(400).send('Nenhum arquivo de áudio foi enviado.');
      return;
    }

    const storageRef = ref(storage, `audio/${title}-${Date.now()}.mp3`);
    await uploadBytes(storageRef, audioBuffer, { contentType: 'audio/mpeg' });

    const url: string = await getDownloadURL(storageRef);

    const audio: IAudio = new Audio({
      title,
      description,
      artist,
      artistAvatar,
      album,
      genre,
      duration,
      releaseDate: releaseDate ? new Date(releaseDate) : new Date(),
      copyright,
      producer,
      composer,
      trackNumber: trackNumber || 1,
      totalTracks: totalTracks || 1,
      collaborators: collaborators || [],
      url,
      cover,
      category,
    });

    await audio.save();

    res.status(201).json({ message: 'Áudio enviado com sucesso!', audio });
  } catch (error) {
    if (error instanceof MulterError) {
      res.status(400).send(`Erro no upload do arquivo: ${error.message}`);
    } else {
      console.error('Erro ao processar o upload:', error);
      res.status(500).send('Erro ao processar o upload.');
    }
  }
});

// Rota para incrementar a contagem de plays
app.post('/audios/:id/play', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const audio = await Audio.findById(id);
    if (!audio) {
      res.status(404).json({ message: 'Áudio não encontrado' });
      return;
    }

    // Incrementa a contagem de plays
    audio.playCount += 1;
    await audio.save();

    res.status(200).json({ message: 'Contagem de plays atualizada', playCount: audio.playCount });
  } catch (error) {
    console.error('Erro ao atualizar a contagem de plays:', error);
    res.status(500).json({ message: 'Erro ao atualizar a contagem de plays' });
  }
});

// Rota para listar áudios com paginação e filtros
app.get('/audios', async (req: Request, res: Response): Promise<void> => {
  try {
    const { artist, genre, album, category } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const filter: any = {};
    if (artist) filter.artist = artist;
    if (genre) filter.genre = genre;
    if (album) filter.album = album;
    if (category) filter.category = category;

    const audios: IAudio[] = await Audio.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('title artist album genre playCount url cover composer');

    const total = await Audio.countDocuments(filter);

    res.status(200).json({
      page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      items: audios,
    });
  } catch (error) {
    console.error('Erro ao obter as músicas:', error);
    res.status(500).send('Erro ao obter as músicas.');
  }
});

// Rota para criar um álbum
app.post('/albums', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, genre, artistAvatar, releaseDate, cover, trackIds } = req.body;

    if (!title || !genre || !artistAvatar || !trackIds || trackIds.length === 0) {
      res.status(400).json({ message: 'Título, gênero, avatar do artista e pelo menos uma música são obrigatórios.' });
      return;
    }

    const tracks = await Audio.find({ _id: { $in: trackIds } });
    if (tracks.length !== trackIds.length) {
      res.status(404).json({ message: 'Uma ou mais músicas não foram encontradas.' });
      return;
    }

    const album = new Album({
      title,
      artist: req.userId,
      artistAvatar,
      genre,
      releaseDate: releaseDate ? new Date(releaseDate) : new Date(),
      cover,
      tracks: trackIds,
    });

    await album.save();

    res.status(201).json({ message: 'Álbum criado com sucesso!', album });
  } catch (error) {
    console.error('Erro ao criar álbum:', error);
    res.status(500).json({ message: 'Erro ao criar o álbum.' });
  }
});

// Rota para listar álbuns de um artista
app.get('/albums', async (req: Request, res: Response): Promise<void> => {
  try {
    const { artist } = req.query;

    const filter: any = {};
    if (artist) filter.artist = artist;

    const albums = await Album.find(filter).populate('tracks', 'title artist duration');

    res.status(200).json({ albums });
  } catch (error) {
    console.error('Erro ao obter os álbuns:', error);
    res.status(500).json({ message: 'Erro ao obter os álbuns.' });
  }
});

// Rota para atualizar um álbum
app.put('/albums/:id', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, genre, releaseDate, cover, trackIds } = req.body;

    const album = await Album.findById(id);
    if (!album) {
      res.status(404).json({ message: 'Álbum não encontrado' });
      return;
    }

    if (album.artist !== req.userId) {
      res.status(403).json({ message: 'Você não tem permissão para atualizar este álbum.' });
      return;
    }

    if (trackIds) {
      const tracks = await Audio.find({ _id: { $in: trackIds } });
      if (tracks.length !== trackIds.length) {
        res.status(404).json({ message: 'Uma ou mais músicas não foram encontradas.' });
        return;
      }
      album.tracks = trackIds;
    }

    album.title = title || album.title;
    album.genre = genre || album.genre;
    album.releaseDate = releaseDate ? new Date(releaseDate) : album.releaseDate;
    album.cover = cover || album.cover;

    await album.save();

    res.status(200).json({ message: 'Álbum atualizado com sucesso!', album });
  } catch (error) {
    console.error('Erro ao atualizar o álbum:', error);
    res.status(500).json({ message: 'Erro ao atualizar o álbum.' });
  }
});

// Rota para excluir um álbum
app.delete('/albums/:id', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const album = await Album.findById(id);
    if (!album) {
      res.status(404).json({ message: 'Álbum não encontrado' });
      return;
    }

    if (album.artist !== req.userId) {
      res.status(403).json({ message: 'Você não tem permissão para excluir este álbum.' });
      return;
    }

    await album.deleteOne();

    res.status(200).json({ message: 'Álbum excluído com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir o álbum:', error);
    res.status(500).json({ message: 'Erro ao excluir o álbum.' });
  }
});

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
