use prosepect_api::app::ApiDoc;
use utoipa::OpenApi;

fn main() -> anyhow::Result<()> {
    println!("{}", ApiDoc::openapi().to_pretty_json()?);
    Ok(())
}
