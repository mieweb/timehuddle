/**
 * Migration: Convert ticket assignedTo from string to array
 * 
 * This migration converts the assignedTo field in tickets from a single string
 * to an array of strings to support multiple assignees per ticket.
 */

module.exports = {
  async up(db) {
    const tickets = db.collection('tickets');
    
    // Find all tickets where assignedTo is not already an array
    const cursor = tickets.find({
      assignedTo: { $exists: true, $not: { $type: 'array' } }
    });
    
    let updated = 0;
    let skipped = 0;
    
    while (await cursor.hasNext()) {
      const ticket = await cursor.next();
      
      // Skip if already an array (shouldn't happen, but just in case)
      if (Array.isArray(ticket.assignedTo)) {
        skipped++;
        continue;
      }
      
      // Convert to array
      const newAssignedTo = ticket.assignedTo ? [ticket.assignedTo] : [];
      
      await tickets.updateOne(
        { _id: ticket._id },
        { $set: { assignedTo: newAssignedTo } }
      );
      
      updated++;
    }
    
    console.log(`✓ Converted ${updated} tickets to array-based assignedTo`);
    if (skipped > 0) {
      console.log(`  (Skipped ${skipped} tickets already using arrays)`);
    }
  },

  async down(db) {
    const tickets = db.collection('tickets');
    
    // Find all tickets where assignedTo is an array
    const cursor = tickets.find({
      assignedTo: { $type: 'array' }
    });
    
    let updated = 0;
    
    while (await cursor.hasNext()) {
      const ticket = await cursor.next();
      
      // Convert array to single value (take first assignee, or null if empty)
      const newAssignedTo = ticket.assignedTo && ticket.assignedTo.length > 0 
        ? ticket.assignedTo[0] 
        : null;
      
      await tickets.updateOne(
        { _id: ticket._id },
        { $set: { assignedTo: newAssignedTo } }
      );
      
      updated++;
    }
    
    console.log(`✓ Reverted ${updated} tickets to single assignedTo`);
  }
};
