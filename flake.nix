{
  description = "Alexa Skill Donda - Custom LLM endpoint for Alexa";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        alexa-skill-donda = pkgs.buildNpmPackage {
          pname = "alexa-skill-donda";
          version = "1.0.0";
          
          src = ./.;
          
          npmDepsHash = "sha256-leciu00S+00tBIoaIA6FehvZ5H8pPezqOvJyVigL9Tk=";
          
          nativeBuildInputs = [ pkgs.makeWrapper ];
          
          dontNpmBuild = true;
          
          installPhase = ''
            mkdir -p $out/lib
            cp -r . $out/lib/alexa-skill-donda
            
            makeWrapper ${pkgs.nodejs_20}/bin/node $out/bin/alexa-skill-donda \
              --add-flags "$out/lib/alexa-skill-donda/server.js" \
              --set NODE_PATH "$out/lib/alexa-skill-donda/node_modules"
          '';
          
          meta = with pkgs.lib; {
            description = "Alexa Skill Donda - Custom LLM endpoint for Alexa";
            license = licenses.mit;
            platforms = platforms.all;
          };
        };
      in
      {
        packages = {
          default = alexa-skill-donda;
          alexa-skill-donda = alexa-skill-donda;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            cloudflared
          ];
          
          shellHook = ''
            echo "Alexa Skill Donda Development Environment"
            echo "Run 'npm install' to install dependencies"
            echo "Run 'npm start' or 'node server.js' to start the server"
          '';
        };
      }) // {
        nixosModules.default = { config, lib, pkgs, ... }:
          with lib;
          let
            cfg = config.services.alexa-skill-donda;
          in
          {
            options.services.alexa-skill-donda = {
              enable = mkEnableOption "Alexa Skill Donda server";

              port = mkOption {
                type = types.port;
                default = 8080;
                description = "Port to listen on";
              };

              skillAppId = mkOption {
                type = types.str;
                default = "amzn1.ask.skill.4af90b07-5af7-4d90-aba1-3018762d2114";
                description = "Alexa Skill Application ID";
              };

              siliconflowApiKey = mkOption {
                type = types.str;
                default = "";
                description = "Siliconflow API key for LLM calls";
              };

              environmentFile = mkOption {
                type = types.nullOr types.path;
                default = null;
                description = "Path to environment file containing secrets (e.g., SILICONFLOW_API_KEY)";
              };

              user = mkOption {
                type = types.str;
                default = "alexa-skill-donda";
                description = "User account under which the service runs";
              };

              group = mkOption {
                type = types.str;
                default = "alexa-skill-donda";
                description = "Group under which the service runs";
              };

              openFirewall = mkOption {
                type = types.bool;
                default = false;
                description = "Open firewall port for the service";
              };
            };

            config = mkIf cfg.enable {
              users.users.${cfg.user} = {
                isSystemUser = true;
                group = cfg.group;
                description = "Alexa Skill Donda service user";
              };

              users.groups.${cfg.group} = {};

              systemd.services.alexa-skill-donda = {
                description = "Alexa Skill Donda Server";
                after = [ "network.target" ];
                wantedBy = [ "multi-user.target" ];

                serviceConfig = {
                  Type = "simple";
                  User = cfg.user;
                  Group = cfg.group;
                  ExecStart = "${self.packages.${pkgs.system}.default}/bin/alexa-skill-donda";
                  Restart = "on-failure";
                  RestartSec = 5;
                  
Environment = [
                      "PORT=${toString cfg.port}"
                      "SKILL_APP_ID=${cfg.skillAppId}"
                      "SILICONFLOW_API_KEY=${cfg.siliconflowApiKey}"
                    ];

                  EnvironmentFile = lib.mkIf (cfg.environmentFile != null) cfg.environmentFile;

                  # Security hardening
                  NoNewPrivileges = true;
                  PrivateTmp = true;
                  ProtectSystem = "strict";
                  ProtectHome = true;
                  StateDirectory = "alexa-skill-donda";
                };
              };

              networking.firewall = mkIf cfg.openFirewall {
                allowedTCPPorts = [ cfg.port ];
              };
            };
          };
      };
}