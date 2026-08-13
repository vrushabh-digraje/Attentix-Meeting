import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Boolean, Float
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'
    
    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    meetings = relationship("Meeting", back_populates="host")
    participations = relationship("Participant", back_populates="user")
    attention_logs = relationship("AttentionLog", back_populates="user")

class Meeting(Base):
    __tablename__ = 'meetings'
    
    id = Column(Integer, primary_key=True)
    meeting_number = Column(String(20), unique=True, nullable=False)
    host_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)

    # Relationships
    host = relationship("User", back_populates="meetings")
    participants = relationship("Participant", back_populates="meeting")
    attention_logs = relationship("AttentionLog", back_populates="meeting")

class Participant(Base):
    __tablename__ = 'participants'
    
    id = Column(Integer, primary_key=True)
    meeting_id = Column(Integer, ForeignKey('meetings.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)
    left_at = Column(DateTime, nullable=True)

    # Relationships
    meeting = relationship("Meeting", back_populates="participants")
    user = relationship("User", back_populates="participations")

class AttentionLog(Base):
    __tablename__ = 'attention_logs'
    
    id = Column(Integer, primary_key=True)
    meeting_id = Column(Integer, ForeignKey('meetings.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    attention_score = Column(Float, nullable=False)  # 0.0 to 100.0
    state = Column(String(20), nullable=False)  # 'Attentive', 'Distracted', 'Inactive'
    warnings_count = Column(Integer, default=0)
    timestamp = Column(DateTime, default=datetime.utcnow)

    # Relationships
    meeting = relationship("Meeting", back_populates="attention_logs")
    user = relationship("User", back_populates="attention_logs")

class ScheduledMeeting(Base):
    __tablename__ = 'scheduled_meetings'
    
    id = Column(Integer, primary_key=True)
    meeting_number = Column(String(20), unique=True, nullable=False)
    host_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    topic = Column(String(100), nullable=False)
    scheduled_time = Column(DateTime, nullable=False)
    duration = Column(Integer, default=40)  # minutes
    reminder_sent = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    host = relationship("User")

# Database session manager helper
class DatabaseManager:
    def __init__(self, database_url=None):
        if not database_url:
            # Fallback to local SQLite if no cloud database URL is configured
            db_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'db')
            os.makedirs(db_dir, exist_ok=True)
            db_path = os.path.join(db_dir, 'attentix.db')
            database_url = f'sqlite:///{db_path}'
            
        if "sqlite" in database_url:
            self.engine = create_engine(database_url, connect_args={"check_same_thread": False})
        else:
            self.engine = create_engine(
                database_url,
                pool_size=10,
                max_overflow=20,
                pool_recycle=1800
            )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.run_migrations()

    def get_session(self):
        return self.SessionLocal()

    def run_migrations(self):
        from sqlalchemy import text
        session = self.get_session()
        try:
            if "sqlite" in str(self.engine.url):
                res = session.execute(text("PRAGMA table_info(scheduled_meetings)")).fetchall()
                cols = [r[1] for r in res]
                if "reminder_sent" not in cols:
                    session.execute(text("ALTER TABLE scheduled_meetings ADD COLUMN reminder_sent BOOLEAN DEFAULT 0 NOT NULL"))
                    session.commit()
            else:
                try:
                    session.execute(text("SELECT reminder_sent FROM scheduled_meetings LIMIT 1"))
                except Exception:
                    session.rollback()
                    session.execute(text("ALTER TABLE scheduled_meetings ADD COLUMN reminder_sent BOOLEAN DEFAULT 0 NOT NULL"))
                    session.commit()
        except Exception as e:
            print(f"[MIGRATION EXCEPTION] {str(e)}")
            session.rollback()
        finally:
            session.close()
