use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct CreateProducer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + EnergyProducer::INIT_SPACE,
        seeds = [b"producer", authority.key().as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_producer(ctx: Context<CreateProducer>, device_id: Pubkey) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    producer.authority = ctx.accounts.authority.key();
    producer.device_id = device_id;
    producer.nonce = 0;
    producer.energy_wh = 0;
    producer.timestamp = 0;
    producer.state = DeviceState::Active;
    msg!("Producer created: authority={}, device_id={}", producer.authority, producer.device_id);
    Ok(())
}
