use std::path::Path;
use serde_json;

async fn test_taskmaster_file_reading() -> Result<(), Box<dyn std::error::Error>> {
    let taskmaster_path = Path::new(".taskmaster/tasks/tasks.json");
    
    if !taskmaster_path.exists() {
        println!("❌ TaskMaster file not found at {}", taskmaster_path.display());
        return Ok(());
    }
    
    let content = tokio::fs::read_to_string(taskmaster_path).await?;
    let data: serde_json::Value = serde_json::from_str(&content)?;
    
    // Extract project name
    let project_name = data.get("metadata")
        .and_then(|m| m.get("projectName"))
        .and_then(|p| p.as_str())
        .unwrap_or("CCTelegram Project");
    
    println!("✅ Project Name: {}", project_name);
    
    // Get tasks from the master tag
    if let Some(tasks) = data.get("tags")
        .and_then(|t| t.get("master"))
        .and_then(|m| m.get("tasks"))
        .and_then(|t| t.as_array()) {
        
        let mut pending = 0u32;
        let mut in_progress = 0u32;
        let mut completed = 0u32;
        let mut blocked = 0u32;
        let mut subtasks_total = 0u32;
        let mut subtasks_completed = 0u32;
        
        for task in tasks {
            let status = task.get("status").and_then(|s| s.as_str()).unwrap_or("pending");
            
            match status {
                "pending" => pending += 1,
                "in-progress" => in_progress += 1,
                "done" => completed += 1,
                "blocked" => blocked += 1,
                _ => {}
            }
            
            // Count subtasks
            if let Some(subtasks) = task.get("subtasks").and_then(|s| s.as_array()) {
                subtasks_total += subtasks.len() as u32;
                
                for subtask in subtasks {
                    let subtask_status = subtask.get("status").and_then(|s| s.as_str()).unwrap_or("pending");
                    if subtask_status == "done" {
                        subtasks_completed += 1;
                    }
                }
            }
        }
        
        let total = pending + in_progress + completed + blocked;
        
        println!("✅ Task Stats:");
        println!("   📋 Total: {}", total);
        println!("   ⏳ Pending: {}", pending);
        println!("   🔄 In Progress: {}", in_progress);
        println!("   ✅ Completed: {}", completed);
        println!("   🚧 Blocked: {}", blocked);
        println!("   📝 Subtasks: {}/{}", subtasks_completed, subtasks_total);
        
        // Test progress bar generation
        let create_progress_bar = |current: u32, total: u32| -> String {
            if total == 0 { return "⬜".repeat(10); }
            
            let percentage = (current as f64 / total as f64 * 100.0).round() as u32;
            let filled = (percentage / 10) as usize;
            let empty = 10 - filled;
            
            format!("{}{} {}%", 
                "🟩".repeat(filled), 
                "⬜".repeat(empty),
                percentage
            )
        };
        
        println!("✅ Progress Bars:");
        println!("   Overall: {}", create_progress_bar(completed, total));
        println!("   Subtasks: {}", create_progress_bar(subtasks_completed, subtasks_total));
        
    } else {
        println!("❌ Could not find tasks in master tag");
    }
    
    Ok(())
}

#[tokio::main]
async fn main() {
    println!("🔍 Testing TaskMaster file reading...");
    
    if let Err(e) = test_taskmaster_file_reading().await {
        println!("❌ Error: {}", e);
    } else {
        println!("✅ Test completed successfully!");
    }
}