# Updating Envio

In Envio, there is an organisation "Anoma", and under Anoma there are multiple
projects. Each project is an indexer on its own that is configured using this
Git repository.

Currently there are the following deployments:

- **anoma-envio**

  Production deployment for the production deployment of Galileo
  (galileo.prod.heliax.app)
- **anoma-envio-dev**

  Development deployment for the development deployment of Galileo
  (galileo.dex.heliax.app)
- **anoma-envio-explorer-prod**

  Productoin deployment for the explorer (explorer.prod.heliax.app)
- **anoma-envio-explorer-dev**

  Development deployment for the Explorer (explorer.dev.heliax.app)
- **anoma-envio-7**

  Poorly chosen name for the development deployment of the V2 indexer.

Envio watches the current repository for new commits on a specific branch.

- **anoma-envio** @ `main`

  autodeploy: off
- **anoma-envio-dev** @ `next`

  autodeploy: on
- **anoma-envio-explorer-prod** @ `main`

  autodeploy: off
- **anoma-envio-explorer-dev** @ `next`

  autodeploy: off
- **anoma-envio-7** @ `heueristik/pa-v2-events`

  autodeploy: on

## Making a new deployment

### Trigger a new deployment

For the projects that have autodeploy set to on, the deployment will trigger
automatically whenever you commit to their branch. For the others, you need to
manually deploy them via the [Envio webportal](https://envio.dev/app/anoma).

Whenever you make a commit on the branch the deployment is monitoring, you will
see that commit show up in the dashboard. For example, if you look
[here](https://envio.dev/app/anoma/anoma-envio-dev) you will see that the
currently deployed commit is `d7aadd9`. Any new commit will be listed under
"latest commits". You can click on "Deploy" on the right side of this commit to
deploy it as an indexer.

Keep in mind that you can deploy as many indexer as you want under a single
project, but you only get 750 hours per month. So 2 deployments will consume
~720 hours per month. I.e., you can only run 1 deployment for a month, or 2
deployments concurrently for half a month. ***Make sure to clean up old deployments.***

### Deployment URLs
For a paid indexer the URLs are static. This means you can do an update and the
URL does not have to change. For a free deployment you have to update the URL
each time because it will be based on the commit hash of the deployment.

There are two paid deployments:

- anoma-envio
- anoma-envio-dev

***All other deployments are on the free tier and need their URLs updated when
you change them.***

If you have deployed a new indexer on the free plan, the url will be found under
the deployment page.

For example, the current deployment for `anoma-envio-explorer-dev` is hash
`d7aad9`, and you can see that deployment's status
[here](https://envio.dev/app/anoma/anoma-envio-explorer-dev/d7aadd9). On the
right side of the page you will see "Deployment Endpoint". This is a public URL
that allows you to call the GraphQL endpoint.

Mind you that this is sensitive data and should not be shared publicly, or used
in the front-end. It is not free to call (usage limits), and we cannot secure it
unless we pay for it. So be careful where you use this URL. ***It should not ever be used in a front-end setting. Only a back-end setting***.


## When All Else Fails

In case the indexer is borking for some unknown reason, you can always delete
the deployment and redeploy it. If you redeploy the same commit you do not have
to update the endpoint URLs since they use the git commit hash under the hood
and will not change if you deploy the same commit again.

There was an instance where the indexers stopped working due to an upstream RPC
being naughty. The simple fix is there to delete the current deployment, wait
until it's removed, and then deploy that same commit again. The instructions for
deploying are written above.