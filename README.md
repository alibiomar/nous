# Nous - A Private Couples Social App

A beautiful, intimate social platform designed exclusively for two people. Share moments, send messages, and enjoy music together—all in a safe, private space.

## Features

### 📸 Photo Feed
- Share moments with captions
- Like and comment on posts
- Real-time feed updates
- Beautiful image gallery

### 💬 Real-time Messaging
- Instant text messages
- Read receipts
- Message timestamps
- Simple polling-based synchronization

### 🎵 Shared Music Player
- Share songs from Spotify, YouTube, Apple Music, etc.
- One song playing at a time for both users
- Quick link sharing to the music platform

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **Database**: Supabase PostgreSQL
- **Authentication**: JWT with secure cookies
- **Styling**: Tailwind CSS with custom design tokens
- **Typography**: Cormorant Garamond (headings), DM Sans (body)

## Color Palette

- **Cream**: `#fef8f9` - Background
- **Blush**: `#fde8ef` - Accents
- **Rose**: `#f2a7bc` - Primary brand color
- **Mauve**: `#c97b96` - Secondary accent
- **Dark Mauve**: `#5a4a5a` - Text

## Setup

### Prerequisites
- Node.js 18+
- Supabase account

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   # or
   pnpm install
   ```

3. Set up environment variables in `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_key
   JWT_SECRET=your_jwt_secret
  DATABASE_ENCRYPTION_KEY=your_database_encryption_key
   ```

  Generate `DATABASE_ENCRYPTION_KEY` with at least 32 random bytes.

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Demo Accounts

The app comes with two hardcoded demo accounts for testing:

**Partner 1**
- Email: `user1@nous.local`
- Password: `password123`

**Partner 2**
- Email: `user2@nous.local`
- Password: `password123`

⚠️ **Security Note**: Change these passwords and JWT_SECRET in production!

## Architecture

### Database Schema

- **users**: User accounts with basic info
- **posts**: Photo posts with captions
- **likes**: Post likes
- **comments**: Post comments
- **messages**: Direct messages between users
- **music**: Currently playing song

### Authentication Flow

1. User logs in with email/password
2. Server validates against hardcoded accounts
3. JWT token generated and stored in HTTP-only cookie
4. Proxy protects all routes except /login and /

### Real-time Updates

- **Messages**: Polled every 1 second
- **Music**: Polled every 2 seconds
- **Feed**: Fetched on demand

## File Structure

```
app/
├── api/
│   ├── auth/
│   │   ├── login/
│   │   ├── logout/
│   │   └── session/
│   ├── posts/
│   │   ├── route.ts
│   │   └── [id]/like/
│   ├── messages/
│   └── music/now-playing/
├── feed/
├── messages/
├── music/
├── login/
└── page.tsx
components/
├── navigation.tsx
├── photo-feed.tsx
├── chat.tsx
├── music-player.tsx
└── ui/
contexts/
└── user.tsx
lib/
├── auth.ts
└── utils.ts
proxy.ts
```

## Customization

### Updating Demo Accounts

Edit `lib/auth.ts` to change the hardcoded accounts:

```typescript
export const ACCOUNTS = [
  {
    id: 'user-1',
    email: 'you@example.com',
    name: 'Your Name',
    password: 'your-password',
  },
  // ...
];
```

### Styling

All colors are defined as CSS custom properties in `app/globals.css`. Update the `:root` section to customize:

```css
:root {
  --cream: #fef8f9;
  --blush: #fde8ef;
  --rose: #f2a7bc;
  --mauve: #c97b96;
  --dark-mauve: #5a4a5a;
}
```

## Deployment

Deploy to Vercel with one click:

```bash
vercel deploy
```

Make sure to set environment variables in Vercel project settings before deploying.

## Future Enhancements

- Image upload to cloud storage (Cloudinary/Supabase Storage)
- Real-time WebSocket updates instead of polling
- Voice and video calls
- Photo albums and organizing moments
- Shared calendar
- Quote/memory sharing

## Privacy & Security

- Application-layer AES-256-GCM encryption for persisted user-generated content
- No data sharing with third parties
- Simple, transparent data handling
- All data stored in your own Supabase instance

---

Made with 💕 for couples
