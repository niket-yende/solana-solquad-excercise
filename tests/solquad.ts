import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import idl from "../target/idl/solquad.json";
import { Solquad } from "../target/types/solquad";

import { utf8 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {BN} from "bn.js";
import { expect } from "chai";

describe("solquad", async () => {
  // const connection = new anchor.web3.Connection(anchor.web3.clusterApiUrl("devnet"), 'confirmed');
  // local connection
  const connection = new anchor.web3.Connection('http://127.0.0.1:8899', 'confirmed');
  // const programId = new anchor.web3.PublicKey("3fowu869PY6frqrYPdhtCzsm7j1jgjpr47HyuyMP9xUH");
  const programId = new anchor.web3.PublicKey("3sd5iCCNUngPFu9QwgeTACP9KiiPaCt1bfBbsCjL64u3");
  // const programId = "3sd5iCCNUngPFu9QwgeTACP9KiiPaCt1bfBbsCjL64u3";

  const admin1 = anchor.web3.Keypair.generate();
  const admin2 = anchor.web3.Keypair.generate();
  const wallet1 = new anchor.Wallet(admin1);
  const wallet2 = new anchor.Wallet(admin2);

  const provider1 = new anchor.AnchorProvider(connection, wallet1, {});
  const provider2 = new anchor.AnchorProvider(connection, wallet2, {});
  const program1 = new Program<Solquad>(idl as Solquad, programId, provider1)
  const program2 = new Program<Solquad>(idl as Solquad, programId, provider2)

  // const escrowOwner = anchor.web3.Keypair.generate();
  // const projectOwner1 = anchor.web3.Keypair.generate();
  // const projectOwner2 = anchor.web3.Keypair.generate();
  // const projectOwner3 = anchor.web3.Keypair.generate();
  // const voter1 = anchor.web3.Keypair.generate();
  // const voter2 = anchor.web3.Keypair.generate();
  // const voter3 = anchor.web3.Keypair.generate();
  // const voter4 = anchor.web3.Keypair.generate();
  // const voter5 = anchor.web3.Keypair.generate();
  // const voter6 = anchor.web3.Keypair.generate();

  const [escrowPDA] = anchor.web3.PublicKey.findProgramAddressSync([
    utf8.encode("escrow"),
    admin1.publicKey.toBuffer(),
  ],
    program1.programId
  );

  const [poolPDA] = anchor.web3.PublicKey.findProgramAddressSync([
    utf8.encode("pool"),
    admin1.publicKey.toBuffer(),
  ],
    program1.programId
  );

  const [projectPDA1] = anchor.web3.PublicKey.findProgramAddressSync([
    utf8.encode("project"),
    poolPDA.toBytes(),
    admin1.publicKey.toBuffer(),
  ],
    program1.programId
  );

  const [differentEscrowPDA] = anchor.web3.PublicKey.findProgramAddressSync([
    utf8.encode("escrow"),
    admin2.publicKey.toBuffer(),
  ],
    program1.programId
  );

  const [differentPoolPDA] = anchor.web3.PublicKey.findProgramAddressSync([
    utf8.encode("pool"),
    admin2.publicKey.toBuffer()
  ],
    program1.programId
  );

  // airdrop(admin1, provider1);
  // airdrop(admin2, provider1);

  // Test 1
  it("initializes escrow and pool", async () => {
    await airdrop(admin1, provider1);
    await airdrop(admin2, provider1);
    const poolIx = await program1.methods.initializePool().accounts({
      poolAccount: poolPDA,
    }).instruction();

    const escrowAndPoolTx = await program1.methods.initializeEscrow(new BN(10000)).accounts({
      escrowAccount: escrowPDA,
    })
    .postInstructions([poolIx])
    .rpc()
      
    console.log("Escrow and Pool are successfully created!", escrowAndPoolTx);

  });

  // Test 2
  it("creates project and add it to the pool twice", async() => {
    try {
      const addProjectIx = await program1.methods.addProjectToPool().accounts({
        escrowAccount: escrowPDA,
        poolAccount: poolPDA,
        projectAccount: projectPDA1,
      })
      .instruction();
  
      const addProjectTx = await program1.methods.initializeProject("My Project").accounts({
        projectAccount: projectPDA1,
        poolAccount: poolPDA
      })
      .postInstructions([addProjectIx, addProjectIx])
      .rpc();
  
      console.log("Project successfully created and added to the pool twice", addProjectTx);
  
      const data = await program1.account.pool.fetch(poolPDA)
      console.log("data projects", data.projects);
    } catch (_err) {
      console.log('Error caught: DuplicateProject');
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.number).to.equal(6000);
      expect(err.error.errorMessage).to.equal('Duplicate project');
    }
  });

  // Test 3
  it("tries to add the project in the different pool", async() => {
    const poolIx = await program2.methods.initializePool().accounts({
      poolAccount: differentPoolPDA,
    }).instruction();

    const escrowIx = await program2.methods.initializeEscrow(new BN(10000)).accounts({
      escrowAccount: differentEscrowPDA,
    })
    .instruction()

    const addProjectTx = await program2.methods.addProjectToPool().accounts({
      projectAccount: projectPDA1,
      poolAccount: differentPoolPDA,
      escrowAccount: differentEscrowPDA
    })
    .preInstructions([escrowIx, poolIx])
    .rpc();

    console.log("Different pool is created and the project is inserted into it", addProjectTx);

    const data = await program1.account.pool.fetch(differentPoolPDA)
    console.log("data projects", data.projects);
  });

  // Test 4
  it("votes for the project and distributes the rewards", async() => {
    const distribIx = await program1.methods.distributeEscrowAmount().accounts({
      escrowAccount: escrowPDA,
      poolAccount: poolPDA,
      projectAccount: projectPDA1,
    })
    .instruction();

    const voteTx = await program1.methods.voteForProject(new BN(10)).accounts({
      poolAccount: poolPDA,
      projectAccount: projectPDA1,
    })
    .postInstructions([distribIx])
    .rpc();
    
    console.log("Successfully voted on the project and distributed weighted rewards", voteTx);

    const ant = await program1.account.project.fetch(projectPDA1)
    console.log("amount", ant.distributedAmt.toString());
  });
});


async function airdrop(user, provider) {
  const AIRDROP_AMOUNT = anchor.web3.LAMPORTS_PER_SOL; // 5 SOL

  // airdrop to user
  const airdropSignature = await provider.connection.requestAirdrop(
    user.publicKey,
    AIRDROP_AMOUNT
  );
  const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();
  
  await provider.connection.confirmTransaction({
    blockhash: blockhash,
    lastValidBlockHeight: lastValidBlockHeight,
    signature: airdropSignature,
  });

  console.log(`Tx Complete: https://explorer.solana.com/tx/${airdropSignature}?cluster=Localnet`)
}