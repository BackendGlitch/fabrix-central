/**
 * Quick database diagnostic script
 * Shows which agents exist and which owner they belong to
 */

const postgres = require('postgres');

const databaseUrl = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MKpo28GmUrbx@ep-empty-rain-ale5i0yo-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function checkDatabase() {
  const sql = postgres(databaseUrl, { ssl: 'require' });

  try {
    console.log('=== FABRIX DATABASE DIAGNOSTIC ===\n');

    // Check all agents
    console.log('📋 AGENTS:');
    const agents = await sql`SELECT id, owner_id, display_name, status FROM agents`;
    console.table(agents);

    // Check jobs with pending status
    console.log('\n📋 JOBS WITH PENDING STATUS:');
    const jobs = await sql`SELECT id, customer_id, printer_id, name, status FROM jobs WHERE status IN ('pending_owner_approval', 'pending') ORDER BY created_at DESC LIMIT 10`;
    console.table(jobs);

    // Check which owner has which agents
    console.log('\n🔍 OWNER AGENT MAPPING:');
    const ownerAgents = await sql`
      SELECT 
        a.owner_id,
        COUNT(*) as agent_count,
        STRING_AGG(a.display_name, ', ') as agent_names
      FROM agents a
      GROUP BY a.owner_id
    `;
    console.table(ownerAgents);

    // Fix: Delete old agent, keep new one
    const correctOwnerId = '7d35f256-294a-4701-9e95-8e656737d6c8';
    console.log(`\n🔧 FIXING: Deleting old agent (keeping the new one)...`);
    
    // Delete the old agent (first one created)
    const deleteResult = await sql`
      DELETE FROM agents 
      WHERE node_id = 'fabrix-agent-dev' 
      AND owner_id != ${correctOwnerId}
      RETURNING id, owner_id, display_name
    `;
    console.log('Deleted old agent:', deleteResult);
    
    // Now update the new agent to correct owner
    console.log(`\nUpdating new agent to correct owner ${correctOwnerId}...`);
    const fixResult = await sql`
      UPDATE agents 
      SET owner_id = ${correctOwnerId}
      WHERE node_id = 'fabrix-agent-dev'
      RETURNING id, owner_id, display_name
    `;
    console.log('Fixed agents:', fixResult);

    // Check your specific owner
    console.log(`\n✅ AGENTS OWNED BY ${correctOwnerId}:`);
    const johnAgents = await sql`SELECT id, display_name, status FROM agents WHERE owner_id = ${correctOwnerId}`;
    console.table(johnAgents);

    // Check if there are any pending jobs for these agents
    if (johnAgents.length > 0) {
      const agentId = johnAgents[0].id;
      
      console.log(`\n🔧 FIXING: Reassigning orphaned pending jobs to your agent (${agentId})...`);
      const orphanedJobs = await sql`
        UPDATE jobs
        SET printer_id = ${agentId}
        WHERE status = 'pending_owner_approval' AND printer_id IS NULL
        RETURNING id, name, status
      `;
      console.log('Reassigned jobs:', orphanedJobs);

      console.log(`\n📋 PENDING JOBS FOR YOUR AGENT:`);
      const pendingJobs = await sql`
        SELECT id, name, status, printer_id, created_at 
        FROM jobs 
        WHERE printer_id = ${agentId}
        AND status = 'pending_owner_approval'
        ORDER BY created_at DESC
      `;
      console.table(pendingJobs);
    }

    console.log('\n=== END DIAGNOSTIC ===');
    await sql.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkDatabase();
