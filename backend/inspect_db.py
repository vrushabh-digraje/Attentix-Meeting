import os
import sqlite3

def inspect_local():
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'db', 'attentix.db')
    
    print("\n" + "=" * 70)
    print("📦 ATTENTIX LOCAL DATABASE INSPECTOR (SQLite)")
    print(f"📍 Database File: {db_path}")
    print("=" * 70)
    
    if not os.path.exists(db_path):
        print(f"❌ Error: Database file not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. Users
    try:
        cursor.execute("SELECT id, username, email, created_at FROM users")
        users = cursor.fetchall()
        print(f"\n👥 REGISTERED USERS ({len(users)} total):")
        print("-" * 70)
        for u in users:
            print(f"  • ID {u[0]:<3} | Username: {u[1]:<16} | Email: {u[2]:<24} | Registered: {u[3]}")
        if not users:
            print("  (No registered users found)")
    except Exception as e:
        print(f"  (Users table error: {e})")

    # 2. Meetings
    try:
        cursor.execute("SELECT id, meeting_number, host_id, is_active, start_time, end_time FROM meetings")
        meetings = cursor.fetchall()
        print(f"\n📹 MEETINGS ({len(meetings)} total):")
        print("-" * 70)
        for m in meetings:
            status = "Active 🟢" if m[3] else "Ended 🔴"
            print(f"  • ID {m[0]:<3} | Room: #{m[1]} | Host ID: {m[2]} | Status: {status} | Started: {m[4]} | Ended: {m[5]}")
        if not meetings:
            print("  (No meetings found)")
    except Exception as e:
        print(f"  (Meetings table error: {e})")

    # 3. Scheduled Meetings
    try:
        cursor.execute("SELECT id, meeting_number, topic, scheduled_time, duration, host_id FROM scheduled_meetings")
        sched = cursor.fetchall()
        print(f"\n📅 SCHEDULED MEETINGS ({len(sched)} total):")
        print("-" * 70)
        for s in sched:
            print(f"  • Room: #{s[1]} | Topic: {s[2]:<16} | Time: {s[3]} | Duration: {s[4]}m | Host ID: {s[5]}")
        if not sched:
            print("  (No scheduled meetings found)")
    except Exception as e:
        print(f"  (Scheduled meetings table error: {e})")

    # 4. Participants
    try:
        cursor.execute("SELECT id, meeting_id, user_id, joined_at, left_at FROM participants")
        participants = cursor.fetchall()
        print(f"\n🎓 PARTICIPANT ATTENDANCE RECORDS ({len(participants)} total):")
        print("-" * 70)
        for p in participants:
            print(f"  • Record #{p[0]} | Meeting ID: {p[1]} | User ID: {p[2]} | Joined: {p[3]} | Left: {p[4]}")
        if not participants:
            print("  (No participant records found)")
    except Exception as e:
        print(f"  (Participants table error: {e})")

    # 5. Attention Logs
    try:
        cursor.execute("SELECT id, meeting_id, user_id, attention_score, state, warnings_count, timestamp FROM attention_logs ORDER BY id DESC LIMIT 15")
        logs = cursor.fetchall()
        cursor.execute("SELECT COUNT(*) FROM attention_logs")
        total_logs = cursor.fetchone()[0]
        
        print(f"\n📊 ATTENTION & WARNING LOGS ({total_logs} total in database):")
        print("-" * 70)
        for l in reversed(logs):
            print(f"  • Meeting ID: {l[1]} | User ID: {l[2]} | Score: {l[3]:>3.0f}% | State: {l[4]:<10} | Warnings: {l[5]} | Time: {l[6]}")
        if total_logs > 15:
            print(f"  ... (showing most recent 15 of {total_logs} total log entries)")
        if total_logs == 0:
            print("  (No attention logs found)")
    except Exception as e:
        print(f"  (Attention logs table error: {e})")

    print("\n" + "=" * 70 + "\n")
    conn.close()

if __name__ == "__main__":
    inspect_local()
