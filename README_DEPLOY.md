# 🦊 HydraFox v3.0 (PocketBase Edition)

HydraFox is an AI-powered Lead Generation Engine migrated from a heavy MongoDB/Redis stack to a lightweight, fast, and real-time **PocketBase** architecture.

---

## 🛠 Prerequisites

Ensure you have the following installed:
- **Node.js** (v20 or higher)
- **PocketBase Binary** (Included in `pocketbase/` or download from [pocketbase.io](https://pocketbase.io/docs/))

---

## 🚀 Setup Instructions

Follow these steps to get the system running on a new machine:

### 1. Install Dependencies
In the root directory, run:
```bash
npm install
cd apps/pb-backend && npm install
```

### 2. Install Scraping Browser
```bash
npx playwright install chromium
```

### 3. Environment Configuration
Create a **`.env`** file in the root directory (refer to WhatsApp/Admin credentials) with the following structure:
```env
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_ADMIN_EMAIL=your-admin@email.com
POCKETBASE_ADMIN_PASSWORD=your-secure-password
```

---

## 📡 Running the System

You need to open **3 separate terminals**:

### Terminal 1: PocketBase Server
```bash
cd pocketbase
./pocketbase.exe serve
```

### Terminal 2: Frontend Dashboard (Next.js)
```bash
cd apps/frontend
npm run dev
```

### Terminal 3: Real-time Worker (Scraper)
```bash
cd apps/pb-backend
npm run dev
```

---

## 🛡 PocketBase Configuration

If starting with a fresh database, ensure these collections exist:

1.  **leads**: (`business_name`, `domain`, `score`, `status`)
2.  **jobs**: (`type`, `status`, `payload`, `logs`)
3.  **queries**: (`query`, `location`, `status`)

### API Rules (Crucial!)
Go to **Settings > API Rules** for each collection and **unlock** (make empty) the following:
- **List/Search Rule**
- **View Rule**
- **Create Rule**
- **Update Rule**

---

## 📁 Project Structure
- `apps/frontend`: Next.js UI using PocketBase Facade.
- `apps/pb-backend`: Node.js worker processing Google Maps & LinkedIn leads.
- `pocketbase/`: Contains the database binary and local data.

---
**Happy Huntnig! 🎯**
