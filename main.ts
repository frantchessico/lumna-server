import express, { Request, Response } from 'express';
import mongoose, { Document, Schema } from 'mongoose';
import { initializeApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getDatabase, ref as dbRef, push, set } from 'firebase/database';
import multer, { MulterError } from 'multer'; // Importa multer para manipulação de arquivos
import dotenv from 'dotenv';
import cors from 'cors';
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
const db = getDatabase(firebaseApp);

// Inicialização do Express
const app = express();
app.use(cors())
const PORT = process.env.PORT || 3000;

// Middleware para JSON
app.use(express.json());

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

// Atualizando o esquema do Mongoose
interface IAudio extends Document {
  title: string;
  description: string;
  artist: string;
  artistAvatar: string; // Avatar do artista
  album: string;
  genre: string;
  duration: number; // duração em segundos
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
  category: AudioCategory; // Adicionar categoria
}

const audioSchema = new Schema<IAudio>({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  artist: { type: String, required: true }, // Nome do artista
  artistAvatar: { type: String, required: true }, // URL do avatar do artista
  album: { type: String, default: '' }, // Nome do álbum, se aplicável
  genre: { type: String, default: '' }, // Gênero musical
  duration: { type: Number, required: true }, // Duração da faixa (em segundos)
  releaseDate: { type: Date, default: Date.now }, // Data de lançamento
  copyright: { type: String, default: '' }, // Informações de direitos autorais
  collaborators: [{ role: { type: String }, name: { type: String } }], // Ex: produtor, compositor, etc.
  trackNumber: { type: Number, default: 1 }, // Número da faixa no álbum
  totalTracks: { type: Number, default: 1 }, // Número total de faixas no álbum
  url: { type: String, required: true }, // URL do arquivo de áudio
  cover: { type: String, default: '' }, // URL da capa do álbum ou single
  createdAt: { type: Date, default: Date.now }, // Data de criação no sistema
  producer: { type: String, default: '' }, // Produtor da faixa
  composer: { type: String, default: '' }, // Compositor da faixa
  category: { type: String, enum: Object.values(AudioCategory), default: AudioCategory.OTHER } // Categoria como enum
});

const Audio = mongoose.model<IAudio>('Audio', audioSchema);

// Definindo o esquema de Favoritos
interface IFavorite extends Document {
  userId: string; // ID do usuário
  audioId: mongoose.Types.ObjectId; // ID do áudio (ObjectId do Mongoose)
  createdAt: Date;
}

const favoriteSchema = new Schema<IFavorite>({
  userId: { type: String, required: true },
  audioId: { type: Schema.Types.ObjectId, ref: 'Audio', required: true }, // Referência para o áudio
  createdAt: { type: Date, default: Date.now }
});

const Favorite = mongoose.model<IFavorite>('Favorite', favoriteSchema);

// Configurando o multer para armazenar o arquivo em memória
const storageMulter = multer.memoryStorage();
const upload = multer({ storage: storageMulter });

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
    category?: AudioCategory; // Nova categoria
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
      artistAvatar, // Adiciona o avatar do artista
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
      category = AudioCategory.OTHER, // Categoria padrão
    } = req.body;
    

    if (!title || !artist || !duration || !artistAvatar) { // Verifica o avatar do artista
      res.status(400).send('Título, Artista, Avatar e Duração são obrigatórios.');
      return;
    }

    const audioDescription: string = description || '';
    const audioAlbum: string = album || '';
    const audioGenre: string = genre || '';
    const audioCover: string = cover || '';
    const audioCopyright: string = copyright || '';
    const audioReleaseDate: Date = releaseDate ? new Date(releaseDate) : new Date();
    const audioProducer: string = producer || '';
    const audioComposer: string = composer || '';
    const audioTrackNumber: number = trackNumber || 1;
    const audioTotalTracks: number = totalTracks || 1;
    const audioCollaborators = collaborators || [];

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
      description: audioDescription,
      artist,
      artistAvatar, // Salvar o avatar do artista
      album: audioAlbum,
      genre: audioGenre,
      duration,
      releaseDate: audioReleaseDate,
      copyright: audioCopyright,
      producer: audioProducer,
      composer: audioComposer,
      trackNumber: audioTrackNumber,
      totalTracks: audioTotalTracks,
      collaborators: [{
        role: 'Producer',
        name: 'SavanaPoint'
      }],
      url,
      cover: audioCover,
      category, // Adicionar categoria
    });

    await audio.save();

    // const audioRef = push(dbRef(db, 'audios'));
    // await set(audioRef, {
    //   id: audio._id,
    //   title: audio.title,
    //   artist: audio.artist,
    //   artistAvatar: audio.artistAvatar, // Avatar do artista no Firebase
    //   album: audio.album,
    //   genre: audio.genre,
    //   duration: audio.duration,
    //   releaseDate: audio.releaseDate,
    //   copyright: audio.copyright,
    //   producer: audio.producer,
    //   composer: audio.composer,
    //   trackNumber: audio.trackNumber,
    //   totalTracks: audio.totalTracks,
    //   collaborators: audio.collaborators,
    //   url: audio.url,
    //   createdAt: audio.createdAt,
    //   cover: audio.cover,
    //   category: audio.category, // Adicionar categoria no Firebase
    // });

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
    if (category) filter.category = category; // Filtro de categoria

    const audios: IAudio[] = await Audio.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

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

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
