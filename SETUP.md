# Nous Setup Guide

Complete step-by-step instructions to get Nous running on your local machine and deploy to Vercel.

## Table of Contents
1. [Local Development Setup](#local-development-setup)
2. [Database Setup](#database-setup)
3. [Configuration](#configuration)
4. [Testing](#testing)
5. [Deployment](#deployment)

## Local Development Setup

### Prerequisites
- Node.js 18.0 or higher
- npm, yarn, or pnpm
- A Supabase account (free tier is fine)
- A Vercel account (for deployment)

### Step 1: Clone and Install

```bash
# Clone the repository
git clone <your-repo-url>
cd nous

# Install dependencies
pnpm install
# or npm install
```

### Step 2: Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and sign up
2. Create a new project
3. Name it "Nous" or similar
4. Choose a password and region (closest to you)
5. Wait for the project to be created (takes ~2 min)

### Step 3: Create Database Tables

1. In Supabase, go to the "SQL Editor" tab
2. Create a new query
3. Copy and paste the SQL from `scripts/01-create-tables.sql`
4. Click "Run" to execute
5. Create another query and run `scripts/02-enable-rls.sql` to activate Row Level Security
6. Run `scripts/08-fix-media-rls-shared-playback.sql` to allow shared media handoff between peers

Alternatively, use the Vercel connection if you've connected Supabase:

```bash
# If using a database migration tool
pnpm db:migrate
```

### Step 4: Get Your API Keys

1. In Supabase, go to "Project Settings" → "API"
2. Copy:
   - **Project URL** (NEXT_PUBLIC_SUPABASE_URL)
   - **Service Role Key** (SUPABASE_SERVICE_ROLE_KEY) - Keep this secret!

### Step 5: Configure Environment

1. Create `.env.local` in the project root:

```bash
cp .env.local.example .env.local
```

2. Edit `.env.local` and add your values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
JWT_SECRET=generate_a_random_secret_here
DATABASE_ENCRYPTION_KEY=generate_a_random_secret_here
```

To generate a random secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`DATABASE_ENCRYPTION_KEY` is used for AES-256-GCM encryption of persisted app content
(messages, comments, post captions/image URLs, media URLs/titles, and profile display fields).

### Step 6: Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Database Setup

### Understanding the Schema

The database has 6 main tables:

#### users
Stores user account information
```sql
- id (UUID, primary key)
- email (text, unique)
- name (text)
- created_at (timestamp)
```

#### posts
Photo posts with captions
```sql
- id (UUID, primary key)
- user_id (UUID, foreign key)
- caption (text)
- image_url (text)
- created_at (timestamp)
```

#### likes
Tracks which users liked which posts
```sql
- id (UUID, primary key)
- post_id (UUID, foreign key)
- user_id (UUID, foreign key)
- created_at (timestamp)
```

#### comments
Comments on posts
```sql
- id (UUID, primary key)
- post_id (UUID, foreign key)
- user_id (UUID, foreign key)
- content (text)
- created_at (timestamp)
```

#### messages
Direct messages between users
```sql
- id (UUID, primary key)
- sender_id (UUID, foreign key)
- content (text)
- image_url (text)
- read (boolean)
- created_at (timestamp)
```

#### music
Currently playing song
```sql
- id (UUID, primary key)
- added_by (UUID, foreign key)
- url (text)
- title (text)
- platform (text)
- created_at (timestamp)
```

### Resetting Database

If you need to reset everything:

1. In Supabase, go to the "SQL Editor" tab
2. Run `scripts/00-reset-tables.sql`
3. Run `scripts/01-create-tables.sql`
4. Run `scripts/02-enable-rls.sql`
5. Run `scripts/08-fix-media-rls-shared-playback.sql`

Alternatively, you can use Supabase's full project reset from "Project Settings" → "Database", then re-run the setup scripts.

## Configuration

### Changing Demo Accounts

Edit `lib/auth.ts`:

```typescript
export const ACCOUNTS = [
  {
    id: 'user-1',
    email: 'you@example.com',
    name: 'Your Name',
    password: 'your-secure-password',
  },
  {
    id: 'user-2',
    email: 'partner@example.com',
    name: 'Partner Name',
    password: 'their-password',
  },
];
```

### Customizing Colors

Edit `app/globals.css` in the `:root` section:

```css
:root {
  --cream: #fef8f9;
  --blush: #fde8ef;
  --rose: #f2a7bc;
  --mauve: #c97b96;
  --dark-mauve: #5a4a5a;
  /* ... add more as needed */
}
```

### Customizing Fonts

The app uses:
- **Headings**: Cormorant Garamond (serif, elegant)
- **Body**: DM Sans (clean, modern)

These are configured in `app/layout.tsx`. Change them there.

## Testing

### Test the Login Flow

1. Start the dev server: `pnpm dev`
2. Go to http://localhost:3000
3. You'll be redirected to login
4. Use one of the demo accounts:
   - Email: `user1@nous.local`
   - Password: `password123`
5. Click the demo account button or enter credentials manually

### Test Photo Feed

1. Click "Photo Feed" in the sidebar
2. Click "Share a Moment"
3. Paste an image URL (e.g., from Unsplash)
4. Add a caption
5. Click "Post"
6. Test liking the post

### Test Messages

1. Click "Messages" in the sidebar
2. Type a message and press Enter or click Send
3. Message should appear with timestamp

### Test Music

1. Click "Music" in the sidebar
2. Click "Share a Song"
3. Enter a Spotify URL (e.g., open.spotify.com/track/...)
4. Add a song title
5. Click "Add Song"
6. Click "Open in Player" to test the link

## Deployment

### Deploy to Vercel

#### Option 1: Using GitHub (Recommended)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project"
4. Select your GitHub repository
5. Configure:
   - Framework: Next.js
   - Root Directory: .
6. Click "Environment Variables"
7. Add:
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase key (secret!)
   - `JWT_SECRET`: Your generated secret (secret!)
8. Click "Deploy"

#### Option 2: Using Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables when prompted
```

### Post-Deployment

1. Visit your deployed URL
2. Test login with demo credentials
3. Test each feature (feed, messages, music)

### Production Security Checklist

- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Change demo account passwords
- [ ] Consider restricting to specific email domains
- [ ] Set up CORS if using external APIs
- [ ] Enable HTTPS (Vercel does this by default)
- [ ] Set up error tracking (e.g., Sentry)
- [ ] Regular backups of Supabase data
- [ ] Monitor environment variables access

### Custom Domain

1. In Vercel project settings
2. Go to "Domains"
3. Add your custom domain
4. Update DNS records as instructed
5. Wait for propagation (typically 24 hours)

## Troubleshooting

### "Failed to fetch posts" error

**Solution**: Check that:
- Supabase URL and key are correct in `.env.local`
- Supabase project is created and database tables exist
- Network requests are allowed

### Login fails with "Invalid email or password"

**Solution**: 
- Verify email matches exactly (case-sensitive)
- Verify password matches exactly
- Check `lib/auth.ts` for correct credentials

### Messages not updating

**Solution**:
- Check browser console for errors
- Verify Supabase connection is working
- Try refreshing the page
- Check that polling is enabled (1 second interval)

### Image URLs not loading

**Solution**:
- Ensure the URL is publicly accessible
- Check that CORS allows loading from that domain
- Try a different image source (Unsplash, Imgur, etc.)

### "Not authenticated" on protected pages

**Solution**:
- Clear browser cookies
- Log out and log in again
- Check `JWT_SECRET` matches between dev/production

## Getting Help

- Check the README.md for overview
- Review code comments in components
- Check browser console (F12) for error messages
- Test in incognito mode to avoid cache issues

## Next Steps

After setup, consider:

1. **Adding image upload** - Integrate Cloudinary or Supabase Storage
2. **Upgrading polling to WebSockets** - Real-time updates
3. **Adding more features** - Calendar, notes, audio messages
4. **Improving security** - Encryption, rate limiting, input validation
5. **Analytics** - Track usage and engagement

---

Happy deploying! 💕
