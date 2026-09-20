## Draw Singles App

A drawing-based matching app. No selfies, no filters — you draw, answer three questions, and get matched with people whose drawings (and conversation styles) align with yours. A trained PyTorch visual encoder (`sketch_matcher`) reads every stroke and turns it into a 250-dimensional similarity vector; that vector drives the groups, the constellation graph, and the swipe deck. The app also includes a real-time chat system, an optional lightweight social-compatibility ML layer that learns from chat outcomes to refine match ranking, an animation lab for doodles, and an image-to-SVG tracer.

## Tech Stack
| Layer           | Stack                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| **Backend**     | Flask, SQLite, Flask-CORS, APScheduler                                     |
| **ML (Visual)** | Main ML Classifier that turns drawings into 250-D similarity vectors            |
| **ML (Social)** | Optional 2-layer projection network that learns from chat history          |
| **Frontend**    | React 18, TypeScript, Vite                                                 |
| **Styling**     | Vanilla CSS with hand-drawn design tokens                                  |

## Prerequisites
Python 3.10+
Node.js 18+ (required by Vite)

## Getting Started

1. Clone the repository
```bash
git clone <your-repo-url>.git
cd draw-singles-app
```

2. Start the backend
```bash
bash
cd backend

# Create virtual environment
python -m venv venv

# Activate
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Initialize the database (creates tables + migrations)
python -c "from db import init_db; init_db()"

# Run the server
python app.py
```
The Flask dev server starts on http://localhost:5001.

3. Start the frontend
```bash
cd frontend

npm install
npm run dev
```

The Vite dev server starts on http://localhost:5173 and proxies /api and /uploads requests to the Flask backend on port 5001, so there are no CORS issues during development.

Optional: After users have chatted, you can train the lightweight social model that re-ranks matches based on conversation quality rather than visual similarity alone.
```bash
cd backend
# Install PyTorch CPU (only needed for this feature)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Train the model (requires at least 3 chat pairs: some active, some ghosted)
python train_social.py
```
Once trained, social_projection.pt is created and the backend will automatically refine match rankings. Retraining also runs automatically every night at 3:00 AM via APScheduler.
